/**
 * Platform response adapters.
 *
 * These parse the Java platform's wire responses into stable UAV domain types.
 * The exact wire shapes differ per deployment; parsers are tolerant and only
 * read known fields. Tightening these adapters is part of the Phase 8
 * integration pass against the real platform.
 */

import type { AirportStatus, DroneStatus, GpsPosition, MissionStatus, PreflightResult } from "./types.ts";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function asNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
	}
	return undefined;
}

function asBoolean(...values: unknown[]): boolean | undefined {
	for (const value of values) {
		if (typeof value === "boolean") return value;
		if (typeof value === "number") return value !== 0;
		if (typeof value === "string") {
			const normalized = value.toLowerCase();
			if (normalized === "true" || normalized === "1" || normalized === "online" || normalized === "running") {
				return true;
			}
			if (normalized === "false" || normalized === "0" || normalized === "offline" || normalized === "stopped") {
				return false;
			}
		}
	}
	return undefined;
}

function asEpochMs(...values: unknown[]): number | undefined {
	const number = asNumber(...values);
	if (number === undefined) return undefined;
	// Heuristic: seconds timestamps (10 digits) become milliseconds.
	return number < 1_000_000_000_000 ? number * 1000 : number;
}

const FLYING_TRUE = new Set(["flying", "in_air", "in-air", "airborne", "hovering"]);
const FLYING_FALSE = new Set(["landed", "parked", "idle", "stopped", "on_ground"]);

function asFlightStatus(...values: unknown[]): boolean | undefined {
	for (const value of values) {
		if (typeof value === "string") {
			const normalized = value.toLowerCase();
			if (FLYING_TRUE.has(normalized)) return true;
			if (FLYING_FALSE.has(normalized)) return false;
		}
	}
	return asBoolean(...values);
}

function parseGps(value: unknown): GpsPosition | undefined {
	const record = asRecord(value);
	if (record === undefined) return undefined;
	// Latitude and longitude are independent fields; a missing one is NOT
	// substituted with the other. Never fabricate coordinates.
	const latitude = asNumber(record.latitude, record.lat);
	const longitude = asNumber(record.longitude, record.lng);
	if (latitude === undefined || longitude === undefined) return undefined;
	if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return undefined;
	return { latitude, longitude, altitude: asNumber(record.altitude, record.alt, record.altitudeM) };
}

function isValidLatitude(value: number): boolean {
	return value >= -90 && value <= 90;
}

function isValidLongitude(value: number): boolean {
	return value >= -180 && value <= 180;
}

export function parseAirportStatus(raw: unknown, airportId: string): AirportStatus {
	const record = asRecord(raw) ?? {};
	const online =
		asBoolean(record.status, record.online_status, record.osd_online_status, record.online, record.onlineStatus) ??
		false;
	const name =
		typeof record.nickname === "string"
			? record.nickname
			: typeof record.device_name === "string"
				? record.device_name
				: undefined;
	return {
		airportId,
		name,
		online,
		mode: typeof record.mode_code === "number" ? String(record.mode_code) : undefined,
		droneBinded: asBoolean(record.bound_status, record.boundStatus),
		battery: asNumber(
			record.battery,
			record.battery_level,
			record.battery_percent,
			record.batteryLevel,
			record.batteryPercent,
		),
		networkQuality: asNumber(
			record.network_quality,
			record.networkQuality,
			record.signal,
			record.signal_strength,
			record.signalStrength,
		),
		lastSeenAt: parseDateTimeMs(record.login_time),
	};
}

/** Parse a "YYYY-MM-DD HH:mm:ss" platform timestamp into epoch milliseconds. */
function parseDateTimeMs(value: unknown): number | undefined {
	if (typeof value !== "string" || value.length === 0) return undefined;
	const parsed = Date.parse(value.replace(" ", "T"));
	return Number.isNaN(parsed) ? undefined : parsed;
}

export function parseDroneStatus(raw: unknown, droneSn: string): DroneStatus {
	const record = asRecord(raw) ?? {};
	const online =
		asBoolean(record.status, record.online_status, record.osd_online_status, record.online, record.onlineStatus) ??
		false;
	return {
		droneSn,
		online,
		flying: asFlightStatus(record.flying, record.flight_status, record.flightStatus) ?? false,
		mode: typeof record.mode === "string" ? record.mode : undefined,
		battery: asNumber(
			record.battery,
			record.battery_level,
			record.battery_percent,
			record.batteryLevel,
			record.batteryPercent,
		),
		speed: asNumber(record.speed, record.speed_mps, record.speedMps),
		gps: parseGps(record.gps ?? record.location ?? record.position),
		lastSeenAt: parseDateTimeMs(record.login_time),
	};
}

const MISSION_STATUS_MAP: Record<string, MissionStatus["status"]> = {
	pending: "pending",
	queued: "pending",
	running: "running",
	in_progress: "running",
	executing: "running",
	paused: "paused",
	completed: "completed",
	finished: "completed",
	done: "completed",
	failed: "failed",
	cancelled: "cancelled",
	canceled: "cancelled",
};

/** DJI wayline job status: 0 issued, 1 running, 2 cancelled, 3 completed, 4 failed, 5 timeout, 6 paused. */
const JOB_STATUS_MAP: Record<number, MissionStatus["status"]> = {
	0: "pending",
	1: "running",
	2: "cancelled",
	3: "completed",
	4: "failed",
	5: "failed",
	6: "paused",
};

export function parseMissionStatus(raw: unknown, missionId: string): MissionStatus {
	const record = asRecord(raw) ?? {};
	const rawStatus = typeof record.status === "string" ? record.status.toLowerCase() : "";
	const numericStatus = typeof record.status === "number" ? record.status : asNumber(record.status);
	const status =
		(numericStatus !== undefined ? JOB_STATUS_MAP[numericStatus] : undefined) ??
		MISSION_STATUS_MAP[rawStatus] ??
		"unknown";
	return {
		missionId,
		status,
		progress: asNumber(record.progress, record.percent),
		startedAt: asEpochMs(record.begin_time, record.started_at, record.start_time, record.beginTime, record.startedAt),
		finishedAt: asEpochMs(
			record.completed_time,
			record.end_time,
			record.finished_at,
			record.completedTime,
			record.endTime,
			record.finishedAt,
		),
		error: typeof record.error === "string" ? record.error : undefined,
	};
}

/**
 * Parse a platform preflight payload.
 *
 * NOTE: the production preflight path is the client-side composed check
 * (HttpPlatformClient.preflightCheck); this parser is exported for future
 * platform-provided preflight endpoints. It fails closed: no explicit pass
 * marker and no checks means NOT passed.
 */
export function parsePreflightResult(raw: unknown, airportId: string): PreflightResult {
	const record = asRecord(raw) ?? {};
	const checks = Array.isArray(record.checks) ? record.checks : [];
	const parsedChecks = checks
		.map((check): PreflightResult["checks"][number] | undefined => {
			const checkRecord = asRecord(check);
			if (checkRecord === undefined) return undefined;
			const name = typeof checkRecord.name === "string" ? checkRecord.name : "unknown";
			const passed = asBoolean(checkRecord.passed, checkRecord.success, checkRecord.ok) ?? false;
			return {
				name,
				passed,
				detail: typeof checkRecord.detail === "string" ? checkRecord.detail : undefined,
			};
		})
		.filter((check): check is PreflightResult["checks"][number] => check !== undefined);
	const explicitPassed = asBoolean(record.passed, record.safe, record.ready);
	// Fail closed: an empty check list without an explicit pass marker is NOT passed.
	const passed = explicitPassed ?? (parsedChecks.length > 0 ? parsedChecks.every((check) => check.passed) : false);
	return {
		airportId,
		passed,
		checks: parsedChecks,
		message: typeof record.message === "string" ? record.message : undefined,
	};
}
