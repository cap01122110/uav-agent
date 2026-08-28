/**
 * UAV domain types (Phase 1 read-only surface).
 *
 * These are the stable domain concepts tools and the platform client speak.
 * Platform-specific response shapes are adapted into these in the client; the
 * raw wire format never reaches tools or the model.
 */

export interface GpsPosition {
	latitude: number;
	longitude: number;
	altitude?: number;
}

/** Result of resolving an airport identifier to its canonical device SN. */
export interface ResolvedAirport {
	/** The identifier the caller used. */
	airportId: string;
	/** Canonical device SN of the airport. */
	deviceSn: string;
	/** Display name (nickname or device name). */
	name?: string;
	online: boolean;
}

export interface AirportStatus {
	/** Airport id used to address the airport (SN or name). */
	airportId: string;
	name?: string;
	online: boolean;
	/** Docking station flight mode, when reported by the platform. */
	mode?: string;
	/** Whether a drone is currently bound to the dock. */
	droneBinded?: boolean;
	/** Battery percentage 0-100, when reported. */
	battery?: number;
	/** Network quality 0-100, when reported. */
	networkQuality?: number;
	/** Last platform contact, epoch milliseconds. */
	lastSeenAt?: number;
}

export interface DroneStatus {
	droneSn: string;
	online: boolean;
	/** In flight, when the platform reports it; undefined = unknown, never fabricated. */
	flying?: boolean;
	mode?: string;
	battery?: number;
	speed?: number;
	gps?: GpsPosition;
	lastSeenAt?: number;
}

export type MissionStatusValue = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled" | "unknown";

export interface MissionStatus {
	missionId: string;
	status: MissionStatusValue;
	/** Progress 0-100, when reported. */
	progress?: number;
	startedAt?: number;
	finishedAt?: number;
	error?: string;
}

export interface PreflightCheck {
	name: string;
	passed: boolean;
	detail?: string;
	/** Informational checks do not gate the result (e.g. drone offline while docked). */
	informational?: boolean;
}

export interface PreflightResult {
	airportId: string;
	passed: boolean;
	checks: PreflightCheck[];
	message?: string;
}
