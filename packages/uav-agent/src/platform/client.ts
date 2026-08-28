/**
 * UavPlatformClient - the single entry point for tool-to-platform calls.
 *
 * Tools never call fetch() directly. They call platform.airport.getStatus()
 * etc.; the client owns base URL, auth, timeouts, request ids, error mapping
 * and response parsing.
 *
 * The real platform wraps every response in { code, message, data }. The
 * envelope and each endpoint's payload are validated at runtime (see
 * validation.ts / pagination.ts): a reachable platform answering with a
 * malformed payload fails with INVALID_RESPONSE instead of degrading into
 * "offline" / "not found" defaults. List endpoints are scanned via the
 * platform's own pagination, so safety decisions never rest on a partial
 * first page.
 */

import type { TokenProvider } from "../auth/token-provider.ts";
import { platformErrorMessage } from "./error-message.ts";
import { PlatformError, type PlatformErrorCode } from "./errors.ts";
import { ACTIVE_JOB_STATUSES, isKnownJobStatus } from "./job-status.ts";
import { collectPagedList, iteratePagedList, type PagedListPayload, validatePagedList } from "./pagination.ts";
import { deviceOnlineStatus, parseAirportStatus, parseDroneStatus, parseMissionStatus } from "./parsers.ts";
import type { HttpTransport } from "./transport.ts";
import { FetchHttpTransport } from "./transport.ts";
import type { AirportStatus, DroneStatus, MissionStatus, PreflightResult, ResolvedAirport } from "./types.ts";

export type { ResolvedAirport } from "./types.ts";

import { invalidResponse, requireEnvelopeCode, requireRecord } from "./validation.ts";

export interface UavPlatformClient {
	readonly airport: AirportApi;
	readonly drone: DroneApi;
	readonly mission: MissionApi;
	readonly safety: SafetyApi;
}

export interface AirportApi {
	/** Query one airport (dock) status by its SN. */
	getStatus(airportId: string, signal?: AbortSignal): Promise<AirportStatus>;
	/** Resolve an airport identifier (SN, nickname or device name) to its device SN. */
	resolve(airportId: string, signal?: AbortSignal): Promise<ResolvedAirport>;
}

export interface DroneApi {
	getStatus(droneSn: string, signal?: AbortSignal): Promise<DroneStatus>;
}

export interface MissionApi {
	getStatus(missionId: string, signal?: AbortSignal): Promise<MissionStatus>;
}

export interface SafetyApi {
	preflightCheck(airportId: string, signal?: AbortSignal): Promise<PreflightResult>;
}

/** Endpoint templates. `{workspace_id}` and `{id}` are substituted per call. */
export interface PlatformEndpoints {
	/** Paginated dock list (index of airports/docks). */
	airportList: string;
	/** Single device detail with live status; `{id}` is the device SN. */
	deviceDetail: string;
	/** Current user's accessible workspaces. */
	workspaceList: string;
	/** Paginated wayline job (mission) list. */
	jobList: string;
}

export const DEFAULT_ENDPOINTS: PlatformEndpoints = {
	airportList: "/manage/api/v1/workspaces/{workspace_id}/devices/getDockListPageVo",
	deviceDetail: "/manage/api/v1/workspaces/{workspace_id}/devices/{id}",
	workspaceList: "/manage/api/v1/workspaces/getWorkspaceListPageVo",
	jobList: "/wayline/api/v1/workspaces/{workspace_id}/getJobListPageVo",
};

export interface UavPlatformClientOptions {
	baseUrl: string;
	tokenProvider: TokenProvider;
	/** Workspace id required by the real platform's REST API. */
	workspaceId?: string;
	/** Page size requested for list scans. Defaults to 100. */
	pageSize?: number;
	timeoutMs?: number;
	transport?: HttpTransport;
	endpoints?: Partial<PlatformEndpoints>;
}

type NotFoundCode = "AIRPORT_NOT_FOUND" | "DRONE_NOT_FOUND" | "MISSION_NOT_FOUND";

/** Job fields matched against the requested mission id. */
const JOB_MATCH_FIELDS = ["job_id", "jobId", "job_name", "jobName"] as const;

export class HttpPlatformClient implements UavPlatformClient {
	readonly airport: AirportApi;
	readonly drone: DroneApi;
	readonly mission: MissionApi;
	readonly safety: SafetyApi;

	private readonly baseUrl: string;
	private readonly tokenProvider: TokenProvider;
	private readonly transport: HttpTransport;
	private readonly endpoints: PlatformEndpoints;
	private readonly workspaceId: string | undefined;
	private readonly pageSize: number;
	private cachedWorkspaceId: string | undefined;

	constructor(options: UavPlatformClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.tokenProvider = options.tokenProvider;
		this.transport = options.transport ?? new FetchHttpTransport({ timeoutMs: options.timeoutMs });
		this.endpoints = { ...DEFAULT_ENDPOINTS, ...options.endpoints };
		this.workspaceId = options.workspaceId;
		this.pageSize = options.pageSize ?? 100;

		this.airport = {
			getStatus: (airportId, signal) => this.getAirportStatus(airportId, signal),
			resolve: (airportId, signal) => this.resolveAirport(airportId, signal),
		};
		this.drone = {
			getStatus: (droneSn, signal) => this.getDroneStatus(droneSn, signal),
		};
		this.mission = {
			getStatus: (missionId, signal) => this.getMissionStatus(missionId, signal),
		};
		this.safety = {
			preflightCheck: (airportId, signal) => this.preflightCheck(airportId, signal),
		};
	}

	private async getAirportStatus(airportId: string, signal?: AbortSignal): Promise<AirportStatus> {
		const detail = await this.resolveAirportDetail(airportId, signal);
		return parseAirportStatus(detail, airportId);
	}

	private async resolveAirport(airportId: string, signal?: AbortSignal): Promise<ResolvedAirport> {
		const detail = await this.resolveAirportDetail(airportId, signal);
		// The canonical SN gates every downstream query; a detail without it is
		// malformed, and falling back to the caller's id could address the wrong device.
		const deviceSn = asOptionalString(detail.device_sn);
		if (deviceSn === undefined) throw invalidResponse("deviceDetail.data.device_sn");
		const online = deviceOnlineStatus(detail);
		if (online === undefined) throw invalidResponse("deviceDetail.data.online");
		return {
			airportId,
			deviceSn,
			name: asOptionalString(detail.nickname) ?? asOptionalString(detail.device_name),
			online,
		};
	}

	private async getDroneStatus(droneSn: string, signal?: AbortSignal): Promise<DroneStatus> {
		const raw = await this.getDeviceDetail(droneSn, "DRONE_NOT_FOUND", signal);
		return parseDroneStatus(raw, droneSn);
	}

	private async getMissionStatus(missionId: string, signal?: AbortSignal): Promise<MissionStatus> {
		const workspaceId = await this.resolveWorkspace(signal);
		const path = this.endpoints.jobList.replace("{workspace_id}", encodeURIComponent(workspaceId));
		const normalized = missionId.toLowerCase();
		let match: Record<string, unknown> | undefined;
		const found = await iteratePagedList(
			"jobList",
			this.pageSize,
			(page) =>
				this.requestPagedList(
					"jobList",
					path,
					"MISSION_NOT_FOUND",
					{ page_num: page, page_size: this.pageSize, workspace_id: workspaceId, job_id: missionId },
					signal,
				),
			(item) => {
				const record = requireRecord(item, "jobList.data.list[]");
				for (const field of JOB_MATCH_FIELDS) {
					const value = record[field];
					if (typeof value === "string" && value.toLowerCase() === normalized) {
						match = record;
						return true;
					}
				}
				return false;
			},
		);
		// Reached only after a complete, trusted scan found no such job.
		if (!found || match === undefined) {
			throw new PlatformError({
				code: "MISSION_NOT_FOUND",
				message: `Mission not found: ${missionId}`,
				retryable: false,
			});
		}
		return parseMissionStatus(match, missionId);
	}

	private async preflightCheck(airportId: string, signal?: AbortSignal): Promise<PreflightResult> {
		// Resolving the airport also verifies it exists (else AIRPORT_NOT_FOUND).
		const airport = await this.resolveAirportDetail(airportId, signal);
		const deviceSn = asOptionalString(airport.device_sn);
		if (deviceSn === undefined) throw invalidResponse("deviceDetail.data.device_sn");
		const childSn = asOptionalString(airport.child_device_sn);
		// mode_code lives on the dock list endpoint, not the device detail.
		const docks = await this.listAirportDocks(signal);
		const dock = docks.find((entry) => entry.deviceSn === deviceSn);
		const modeCode = dock?.modeCode;
		const hasActiveJob = await this.airportHasActiveJob(deviceSn, signal);
		const idleState = airportIdleState(modeCode, hasActiveJob);

		const airportOnline = deviceOnlineStatus(airport);
		const checks: PreflightResult["checks"] = [
			{
				name: "airport_online",
				// Unknown online state fails the check (fail closed); it is never
				// reported as a plain "offline".
				passed: airportOnline === true,
				detail: airportOnline === undefined ? "机场在线状态未知,按不可飞处理" : undefined,
			},
			{
				name: "airport_idle",
				passed: idleState === "idle",
				detail: idleDetail(idleState),
			},
			{
				name: "drone_bound",
				passed: childSn !== undefined,
				detail: childSn === undefined ? "机场未绑定无人机" : childSn,
			},
		];
		if (childSn !== undefined) {
			const drone = await this.getDeviceDetail(childSn, "DRONE_NOT_FOUND", signal);
			// A docked drone being offline must not alone block the check; it is
			// reported as informational only. An unknown drone online state is
			// equally informational - missing never masquerades as offline.
			const droneOnline = deviceOnlineStatus(drone);
			checks.push({
				name: "drone_online",
				passed: droneOnline === true,
				detail: droneOnline === undefined ? "无人机在线状态未知" : (asOptionalString(drone.device_name) ?? childSn),
				informational: true,
			});
		}
		// Fail closed: every non-informational check must pass; missing/unknown
		// state never defaults to flyable.
		const passed = checks.filter((check) => check.informational !== true).every((check) => check.passed);
		return {
			airportId,
			passed,
			checks,
			message: passed ? "All checks passed" : "One or more checks failed",
		};
	}

	/**
	 * Whether the airport has a running or paused mission (explicitly busy).
	 *
	 * Scans every page of the SN-filtered job list and stops at the first
	 * active job. Any failed page, malformed payload or inconsistent
	 * pagination throws, so "unknown" can never resolve as "no active job".
	 */
	private async airportHasActiveJob(dockSn: string, signal?: AbortSignal): Promise<boolean> {
		const workspaceId = await this.resolveWorkspace(signal);
		const path = this.endpoints.jobList.replace("{workspace_id}", encodeURIComponent(workspaceId));
		return iteratePagedList(
			"jobList",
			this.pageSize,
			(page) =>
				this.requestPagedList(
					"jobList",
					path,
					"MISSION_NOT_FOUND",
					{ page_num: page, page_size: this.pageSize, workspace_id: workspaceId, sn: dockSn },
					signal,
				),
			(item) => {
				const record = requireRecord(item, "jobList.data.list[]");
				const raw = record.status;
				const status =
					typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
				// A job status must be a known whole number (0-6); anything else
				// (7, 99, 1.5, NaN) is unknown, not inactive.
				if (!isKnownJobStatus(status)) throw invalidResponse("jobList.data.list[].status");
				return ACTIVE_JOB_STATUSES.has(status);
			},
		);
	}

	/** Resolve an airport by SN, nickname or device name and return its device detail. */
	private async resolveAirportDetail(airportId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
		// Fast path: an SN directly addresses the device detail endpoint.
		const direct = await this.tryDirectAirportDetail(airportId, signal);
		if (direct !== undefined) {
			return direct;
		}
		// Slow path: resolve display names (nickname) which only exist on the
		// detail endpoint. A listed dock whose own detail is missing is
		// tolerated; any other dock failure makes the scan incomplete and must
		// fail closed instead of turning into AIRPORT_NOT_FOUND.
		const docks = await this.listAirportDocks(signal);
		const settled = await Promise.allSettled(
			docks.map((dock) => this.getDeviceDetail(dock.deviceSn, "AIRPORT_NOT_FOUND", signal)),
		);
		const details: Record<string, unknown>[] = [];
		let failure: unknown;
		for (const result of settled) {
			if (result.status === "fulfilled") {
				details.push(result.value);
			} else if (failure === undefined && !isNotFound(result.reason)) {
				failure = result.reason;
			}
		}
		const normalized = airportId.toLowerCase();
		const match = details.find((detail) => {
			for (const field of ["device_sn", "nickname", "device_name"]) {
				const value = detail[field];
				if (typeof value === "string" && value.toLowerCase() === normalized) return true;
			}
			return false;
		});
		if (match !== undefined) {
			return match;
		}
		if (failure !== undefined) {
			throw failure;
		}
		throw new PlatformError({
			code: "AIRPORT_NOT_FOUND",
			message: `Airport not found: ${airportId}`,
			retryable: false,
		});
	}

	/** Direct SN lookup that only succeeds when the device is a dock (airport). */
	private async tryDirectAirportDetail(
		airportId: string,
		signal?: AbortSignal,
	): Promise<Record<string, unknown> | undefined> {
		try {
			const record = await this.getDeviceDetail(airportId, "AIRPORT_NOT_FOUND", signal);
			if (record.type === 3 || record.deviceType === 3) {
				return record;
			}
			return undefined;
		} catch (error) {
			// Only a genuine "this id is not a directly-addressable airport SN"
			// miss falls back to the name scan. Permission, timeout,
			// unavailability, invalid responses and caller aborts propagate
			// instead of being masked as AIRPORT_NOT_FOUND.
			if (isNotFound(error)) {
				return undefined;
			}
			throw error;
		}
	}

	/** List dock-type devices (airports) in the workspace, across all pages. */
	private async listAirportDocks(signal?: AbortSignal): Promise<Array<{ deviceSn: string; modeCode?: number }>> {
		const workspaceId = await this.resolveWorkspace(signal);
		const path = this.endpoints.airportList.replace("{workspace_id}", encodeURIComponent(workspaceId));
		const items = await collectPagedList("dockList", this.pageSize, (page) =>
			this.requestPagedList(
				"dockList",
				path,
				"AIRPORT_NOT_FOUND",
				{ page_num: page, page_size: this.pageSize, workspace_id: workspaceId },
				signal,
			),
		);
		const result: Array<{ deviceSn: string; modeCode?: number }> = [];
		for (const item of items) {
			const record = requireRecord(item, "dockList.data.list[]");
			if (typeof record.deviceType !== "number" || !Number.isFinite(record.deviceType)) {
				throw invalidResponse("dockList.data.list[].deviceType");
			}
			// deviceType 3 = dock/airport (the platform's DJI dock type).
			if (record.deviceType === 3) {
				const deviceSn = record.deviceSn;
				if (typeof deviceSn !== "string" || deviceSn.length === 0) {
					throw invalidResponse("dockList.data.list[].deviceSn");
				}
				result.push({ deviceSn, modeCode: asFiniteNumber(record.modeCode) });
			}
		}
		return result;
	}

	private async getDeviceDetail(
		deviceSn: string,
		notFoundCode: NotFoundCode = "AIRPORT_NOT_FOUND",
		signal?: AbortSignal,
	): Promise<Record<string, unknown>> {
		const workspaceId = await this.resolveWorkspace(signal);
		return this.request<Record<string, unknown>>({
			method: "GET",
			path: this.endpoints.deviceDetail
				.replace("{workspace_id}", encodeURIComponent(workspaceId))
				.replace("{id}", encodeURIComponent(deviceSn)),
			context: "deviceDetail",
			notFoundCode,
			signal,
			validateData: (data) => requireRecord(data, "deviceDetail.data"),
		});
	}

	private requestPagedList(
		context: string,
		path: string,
		notFoundCode: NotFoundCode,
		body: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<PagedListPayload> {
		return this.request<PagedListPayload>({
			method: "POST",
			path,
			context,
			notFoundCode,
			body,
			signal,
			validateData: (data) => validatePagedList(data, context, this.pageSize),
		});
	}

	private async resolveWorkspace(signal?: AbortSignal): Promise<string> {
		if (this.cachedWorkspaceId !== undefined) return this.cachedWorkspaceId;
		if (this.workspaceId !== undefined && this.workspaceId.length > 0) {
			this.cachedWorkspaceId = this.workspaceId;
			return this.cachedWorkspaceId;
		}
		// The workspace list is the authoritative source for what this token can
		// actually access; the JWT claim is not reliably present.
		const fromList = await this.resolveWorkspaceFromList(signal);
		if (fromList !== undefined) {
			this.cachedWorkspaceId = fromList;
			return fromList;
		}
		const token = await this.tokenProvider.getToken(signal);
		const fromToken = this.resolveWorkspaceId(token);
		if (fromToken !== undefined) {
			this.cachedWorkspaceId = fromToken;
			return fromToken;
		}
		throw new PlatformError({
			code: "INVALID_REQUEST",
			message: "Platform client could not resolve a workspace id",
			retryable: false,
		});
	}

	/** Return the first workspace this token can enter, preferring joined ones. */
	private async resolveWorkspaceFromList(signal?: AbortSignal): Promise<string | undefined> {
		const items = await collectPagedList("workspaceList", this.pageSize, (page) =>
			this.requestPagedList(
				"workspaceList",
				this.endpoints.workspaceList,
				"AIRPORT_NOT_FOUND",
				{ page_num: page, page_size: this.pageSize, region_code: "" },
				signal,
			),
		);
		let first: string | undefined;
		for (const item of items) {
			const record = requireRecord(item, "workspaceList.data.list[]");
			const id = typeof record.workspace_id === "string" ? record.workspace_id : undefined;
			if (id === undefined || id.length === 0) continue;
			first ??= id;
			const capabilities =
				typeof record.capabilities === "object" && record.capabilities !== null
					? (record.capabilities as Record<string, unknown>)
					: {};
			const canEnter = record.joined === true || capabilities.can_enter === true;
			if (canEnter) return id;
		}
		return first;
	}

	private resolveWorkspaceId(token: string): string | undefined {
		const configured = this.workspaceId;
		if (configured !== undefined && configured.length > 0) return configured;
		return extractWorkspaceIdFromJwt(token);
	}

	/**
	 * Perform an authenticated request and unwrap the platform envelope.
	 *
	 * The envelope must be a record carrying a numeric `code`; `code != 0`
	 * maps to the existing business-error path, and `code = 0` data is handed
	 * to the endpoint's `validateData` guard. Nothing defaults: a missing or
	 * non-numeric code, or a payload failing validation, throws
	 * INVALID_RESPONSE.
	 */
	private async request<T>(options: {
		method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
		path: string;
		/** Endpoint name used in validation error contexts (no payload content). */
		context: string;
		notFoundCode: NotFoundCode;
		body?: unknown;
		signal?: AbortSignal;
		/** Runtime validation of `data`; runs only after `code = 0`. */
		validateData: (data: unknown) => T;
	}): Promise<T> {
		const token = await this.tokenProvider.getToken(options.signal);
		try {
			const envelope = await this.transport.request<unknown>({
				method: options.method,
				url: `${this.baseUrl}${options.path}`,
				headers: { "x-auth-token": token },
				body: options.body,
				signal: options.signal,
			});
			const record = requireRecord(envelope, `${options.context}.envelope`);
			const code = requireEnvelopeCode(record, options.context);
			// The platform signals business failures with a non-zero code. The
			// upstream `message` is untrusted text and never becomes the public
			// error message; the stable per-code wording is used instead.
			if (code !== 0) {
				const mapped = mapBusinessCode(code);
				throw new PlatformError(
					{ code: mapped, message: platformErrorMessage(mapped), retryable: false },
					{ requestId: undefined },
				);
			}
			return options.validateData(record.data);
		} catch (error) {
			if (error instanceof PlatformError && error.status === 404) {
				throw new PlatformError(
					{ code: options.notFoundCode, message: error.message, retryable: false },
					{ status: 404, requestId: error.requestId, cause: error },
				);
			}
			throw error;
		}
	}
}

/** Whether an error is a plain "entity not found" (tolerable during scans). */
function isNotFound(error: unknown): boolean {
	return (
		error instanceof PlatformError &&
		(error.code === "AIRPORT_NOT_FOUND" || error.code === "DRONE_NOT_FOUND" || error.code === "MISSION_NOT_FOUND")
	);
}

/** Map a platform business code to a stable error code. */
function mapBusinessCode(_code: number): PlatformErrorCode {
	// Business codes are platform-specific; keep them stable as UNKNOWN_ERROR
	// until the real platform's code table is mapped during integration.
	return "UNKNOWN_ERROR";
}

/** Extract the workspace_id claim from a JWT payload without verifying the signature. */
function extractWorkspaceIdFromJwt(token: string): string | undefined {
	const payloadPart = token.split(".")[1];
	if (payloadPart === undefined) return undefined;
	try {
		const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
		const payload = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as { workspace_id?: unknown };
		const workspaceId = payload.workspace_id;
		return typeof workspaceId === "string" && workspaceId.length > 0 ? workspaceId : undefined;
	} catch {
		return undefined;
	}
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Airport idle semantics from the real platform: mode_code 0/1 are idle,
 * explicit busy codes (taking off / landing / returning / operating) are
 * busy, and anything unknown fails closed (not idle).
 */
type AirportIdleState = "idle" | "busy" | "unknown";

function airportIdleState(modeCode: number | undefined, hasActiveJob: boolean): AirportIdleState {
	if (hasActiveJob) return "busy";
	if (modeCode === 0 || modeCode === 1) return "idle";
	if (modeCode !== undefined && BUSY_MODE_CODES.has(modeCode)) return "busy";
	return "unknown";
}

/** Platform codes that explicitly mean the airport is operating. */
const BUSY_MODE_CODES = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10]);

function idleDetail(state: AirportIdleState): string | undefined {
	switch (state) {
		case "idle":
			return "机场空闲";
		case "busy":
			return "机场忙碌(有执行中任务或正在作业)";
		case "unknown":
			return "机场空闲状态未知,按不可飞处理";
	}
}
