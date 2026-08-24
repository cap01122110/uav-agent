/**
 * UavPlatformClient - the single entry point for tool-to-platform calls.
 *
 * Tools never call fetch() directly. They call platform.airport.getStatus()
 * etc.; the client owns base URL, auth, timeouts, request ids, error mapping
 * and response parsing.
 *
 * The real platform wraps every response in { code, message, data }; the
 * client unwraps the envelope and checks `code` before returning `data`.
 */

import type { TokenProvider } from "../auth/token-provider.ts";
import { PlatformError, type PlatformErrorCode } from "./errors.ts";
import { parseAirportStatus, parseDroneStatus, parseMissionStatus } from "./parsers.ts";
import type { HttpTransport } from "./transport.ts";
import { FetchHttpTransport } from "./transport.ts";
import type { AirportStatus, DroneStatus, MissionStatus, PreflightResult } from "./types.ts";

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

/** Result of resolving an airport identifier. */
export interface ResolvedAirport {
	/** The identifier the caller used. */
	airportId: string;
	/** Canonical device SN of the airport. */
	deviceSn: string;
	/** Display name (nickname or device name). */
	name?: string;
	online: boolean;
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
	timeoutMs?: number;
	transport?: HttpTransport;
	endpoints?: Partial<PlatformEndpoints>;
}

interface PlatformEnvelope<T = unknown> {
	code?: unknown;
	message?: unknown;
	data?: T;
}

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
	private cachedWorkspaceId: string | undefined;

	constructor(options: UavPlatformClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.tokenProvider = options.tokenProvider;
		this.transport = options.transport ?? new FetchHttpTransport({ timeoutMs: options.timeoutMs });
		this.endpoints = { ...DEFAULT_ENDPOINTS, ...options.endpoints };
		this.workspaceId = options.workspaceId;

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
		const record = detail as Record<string, unknown>;
		return {
			airportId,
			deviceSn: asOptionalString(record.device_sn) ?? airportId,
			name: asOptionalString(record.nickname) ?? asOptionalString(record.device_name),
			online: asTruthy(record.status) || asTruthy(record.osd_online_status),
		};
	}

	private async getDroneStatus(droneSn: string, signal?: AbortSignal): Promise<DroneStatus> {
		const raw = await this.getDeviceDetail(droneSn, "DRONE_NOT_FOUND", signal);
		return parseDroneStatus(raw, droneSn);
	}

	private async getMissionStatus(missionId: string, signal?: AbortSignal): Promise<MissionStatus> {
		const workspaceId = await this.resolveWorkspace(signal);
		const data = await this.request<{ list?: unknown }>({
			method: "POST",
			path: this.endpoints.jobList.replace("{workspace_id}", encodeURIComponent(workspaceId)),
			notFoundCode: "MISSION_NOT_FOUND",
			body: { page_num: 1, page_size: 100, workspace_id: workspaceId, job_id: missionId },
			signal,
		});
		const items = Array.isArray(data?.list) ? data.list : [];
		const normalized = missionId.toLowerCase();
		const match = items.find((item) => {
			if (typeof item !== "object" || item === null) return false;
			const record = item as Record<string, unknown>;
			for (const field of ["job_id", "jobId", "job_name", "jobName"]) {
				const value = record[field];
				if (typeof value === "string" && value.toLowerCase() === normalized) return true;
			}
			return false;
		});
		if (match === undefined) {
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
		const deviceSn = asOptionalString(airport.device_sn) ?? airportId;
		const childSn = asOptionalString(airport.child_device_sn);
		// mode_code lives on the dock list endpoint, not the device detail.
		const docks = await this.listAirportDocks(signal);
		const dock = docks.find((entry) => entry.deviceSn === deviceSn);
		const modeCode = dock?.modeCode;
		const hasActiveJob = await this.airportHasActiveJob(deviceSn, signal);
		const idleState = airportIdleState(modeCode, hasActiveJob);

		const checks: PreflightResult["checks"] = [
			{
				name: "airport_online",
				passed: asTruthy(airport.status) || asTruthy(airport.osd_online_status),
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
			const drone = (await this.getDeviceDetail(childSn, "DRONE_NOT_FOUND", signal)) as Record<string, unknown>;
			// A docked drone being offline must not alone block the check; it is
			// reported as informational only.
			checks.push({
				name: "drone_online",
				passed: asTruthy(drone.status) || asTruthy(drone.osd_online_status),
				detail: asOptionalString(drone.device_name) ?? childSn,
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

	/** Whether the airport has a running or paused mission (explicitly busy). */
	private async airportHasActiveJob(dockSn: unknown, signal?: AbortSignal): Promise<boolean> {
		const sn = asOptionalString(dockSn);
		if (sn === undefined) return false;
		const workspaceId = await this.resolveWorkspace(signal);
		const data = await this.request<{ list?: unknown }>({
			method: "POST",
			path: this.endpoints.jobList.replace("{workspace_id}", encodeURIComponent(workspaceId)),
			notFoundCode: "MISSION_NOT_FOUND",
			body: { page_num: 1, page_size: 100, workspace_id: workspaceId, sn },
			signal,
		});
		const items = Array.isArray(data?.list) ? data.list : [];
		return items.some((item) => {
			if (typeof item !== "object" || item === null) return false;
			const record = item as Record<string, unknown>;
			const status = typeof record.status === "number" ? record.status : Number(record.status);
			// 1 = running, 6 = paused on the real platform.
			return status === 1 || status === 6;
		});
	}

	/** Resolve an airport by SN, nickname or device name and return its device detail. */
	private async resolveAirportDetail(airportId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
		// Fast path: an SN directly addresses the device detail endpoint.
		const direct = await this.tryDirectAirportDetail(airportId, signal);
		if (direct !== undefined) {
			return direct;
		}
		// Slow path: resolve display names (nickname) which only exist on the
		// detail endpoint. Unrelated dock failures must not fail the lookup.
		const docks = await this.listAirportDocks(signal);
		const settled = await Promise.allSettled(
			docks.map((dock) => this.getDeviceDetail(dock.deviceSn, "AIRPORT_NOT_FOUND", signal)),
		);
		const details = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
		const normalized = airportId.toLowerCase();
		const match = details.find((detail) => {
			const record = detail as Record<string, unknown>;
			for (const field of ["device_sn", "nickname", "device_name"]) {
				const value = record[field];
				if (typeof value === "string" && value.toLowerCase() === normalized) return true;
			}
			return false;
		});
		if (match === undefined) {
			throw new PlatformError({
				code: "AIRPORT_NOT_FOUND",
				message: `Airport not found: ${airportId}`,
				retryable: false,
			});
		}
		return match as Record<string, unknown>;
	}

	/** Direct SN lookup that only succeeds when the device is a dock (airport). */
	private async tryDirectAirportDetail(
		airportId: string,
		signal?: AbortSignal,
	): Promise<Record<string, unknown> | undefined> {
		try {
			const raw = await this.getDeviceDetail(airportId, "AIRPORT_NOT_FOUND", signal);
			const record = raw as Record<string, unknown>;
			if (record.type === 3 || record.deviceType === 3) {
				return record;
			}
			return undefined;
		} catch {
			// 404 or any other failure: fall back to name-based resolution.
			return undefined;
		}
	}

	/** List dock-type devices (airports) in the workspace. */
	private async listAirportDocks(signal?: AbortSignal): Promise<Array<{ deviceSn: string; modeCode?: number }>> {
		const workspaceId = await this.resolveWorkspace(signal);
		const body = { page_num: 1, page_size: 100, workspace_id: workspaceId };
		const data = await this.request<{ list?: unknown }>({
			method: "POST",
			path: this.endpoints.airportList.replace("{workspace_id}", encodeURIComponent(workspaceId)),
			notFoundCode: "AIRPORT_NOT_FOUND",
			body,
			signal,
		});
		const items = Array.isArray(data?.list) ? data.list : [];
		const result: Array<{ deviceSn: string; modeCode?: number }> = [];
		for (const item of items) {
			if (typeof item !== "object" || item === null) continue;
			const record = item as Record<string, unknown>;
			// deviceType 3 = dock/airport (the platform's DJI dock type).
			if (record.deviceType !== 3) continue;
			if (typeof record.deviceSn === "string" && record.deviceSn.length > 0) {
				result.push({ deviceSn: record.deviceSn, modeCode: asFiniteNumber(record.modeCode) });
			}
		}
		return result;
	}

	private async getDeviceDetail(
		deviceSn: string,
		notFoundCode: "AIRPORT_NOT_FOUND" | "DRONE_NOT_FOUND" = "AIRPORT_NOT_FOUND",
		signal?: AbortSignal,
	): Promise<unknown> {
		const workspaceId = await this.resolveWorkspace(signal);
		return this.request<unknown>({
			method: "GET",
			path: this.endpoints.deviceDetail
				.replace("{workspace_id}", encodeURIComponent(workspaceId))
				.replace("{id}", encodeURIComponent(deviceSn)),
			notFoundCode,
			signal,
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
		const data = await this.request<{ list?: unknown }>({
			method: "POST",
			path: this.endpoints.workspaceList,
			notFoundCode: "AIRPORT_NOT_FOUND",
			body: { page_num: 1, page_size: 100, region_code: "" },
			signal,
		});
		const items = Array.isArray(data?.list) ? data.list : [];
		let first: string | undefined;
		for (const item of items) {
			if (typeof item !== "object" || item === null) continue;
			const record = item as Record<string, unknown>;
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

	/** Perform an authenticated request and unwrap the platform envelope. */
	private async request<T>(options: {
		method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
		path: string;
		notFoundCode: "AIRPORT_NOT_FOUND" | "DRONE_NOT_FOUND" | "MISSION_NOT_FOUND";
		body?: unknown;
		signal?: AbortSignal;
	}): Promise<T> {
		const token = await this.tokenProvider.getToken(options.signal);
		try {
			const envelope = await this.transport.request<PlatformEnvelope<T>>({
				method: options.method,
				url: `${this.baseUrl}${options.path}`,
				headers: { "x-auth-token": token },
				body: options.body,
				signal: options.signal,
			});
			// The platform signals business failures with a non-zero code.
			if (envelope.code !== undefined && envelope.code !== 0) {
				const message = typeof envelope.message === "string" ? envelope.message : "Platform request failed";
				throw new PlatformError(
					{ code: mapBusinessCode(Number(envelope.code)), message, retryable: false },
					{ requestId: undefined },
				);
			}
			return envelope.data as T;
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

function asTruthy(value: unknown): boolean {
	return value === true || value === 1 || value === "true" || value === "1";
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
