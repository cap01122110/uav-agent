/**
 * Dev stub platform client - DEVELOPMENT ONLY.
 *
 * Marked clearly and separated from the production client. Used only when the
 * real Java platform is unreachable for local development. The default
 * production path (createPlatformClientFromEnv / HttpPlatformClient) never
 * uses this stub.
 *
 * Stub responses are deterministic but carry an explicit "stub: true" marker so
 * downstream code and tests can never mistake them for real platform state.
 */

import type { AirportApi, DroneApi, MissionApi, ResolvedAirport, SafetyApi, UavPlatformClient } from "./client.ts";
import { PlatformError } from "./errors.ts";
import type { AirportStatus, DroneStatus, MissionStatus, PreflightResult } from "./types.ts";

export interface DevStubOptions {
	/** Airport ids that exist in the stub. */
	airports?: string[];
	/** Drone Sns that exist in the stub. */
	drones?: string[];
}

export const DEV_STUB_MARKER = "stub" as const;

export class DevStubPlatformClient implements UavPlatformClient {
	readonly airport: AirportApi;
	readonly drone: DroneApi;
	readonly mission: MissionApi;
	readonly safety: SafetyApi;

	private readonly airports: Set<string>;
	private readonly drones: Set<string>;

	constructor(options: DevStubOptions = {}) {
		this.airports = new Set(options.airports ?? ["Test-01"]);
		this.drones = new Set(options.drones ?? ["drone-001"]);

		this.airport = {
			getStatus: (airportId) => {
				if (!this.airports.has(airportId)) {
					throw new PlatformError({
						code: "AIRPORT_NOT_FOUND",
						message: `Airport not found: ${airportId}`,
						retryable: false,
					});
				}
				return Promise.resolve(devStubAirportStatus(airportId));
			},
			resolve: (airportId) => {
				if (!this.airports.has(airportId)) {
					throw new PlatformError({
						code: "AIRPORT_NOT_FOUND",
						message: `Airport not found: ${airportId}`,
						retryable: false,
					});
				}
				return Promise.resolve({
					airportId,
					deviceSn: airportId,
					name: airportId,
					online: true,
				} satisfies ResolvedAirport);
			},
		};
		this.drone = {
			getStatus: (droneSn) => {
				if (!this.drones.has(droneSn)) {
					throw new PlatformError({
						code: "DRONE_NOT_FOUND",
						message: `Drone not found: ${droneSn}`,
						retryable: false,
					});
				}
				return Promise.resolve(devStubDroneStatus(droneSn));
			},
		};
		this.mission = {
			getStatus: (missionId) => Promise.resolve(devStubMissionStatus(missionId)),
		};
		this.safety = {
			preflightCheck: (airportId) => Promise.resolve(devStubPreflight(airportId)),
		};
	}
}

/** Internal marker embedded in every stub result. */
type StubMarked<T> = T & { source: typeof DEV_STUB_MARKER };

export function devStubAirportStatus(airportId: string): StubMarked<AirportStatus> {
	return {
		airportId,
		name: airportId,
		online: true,
		mode: "idle",
		droneBinded: true,
		battery: 92,
		networkQuality: 88,
		lastSeenAt: Date.now(),
		source: DEV_STUB_MARKER,
	};
}

export function devStubDroneStatus(droneSn: string): StubMarked<DroneStatus> {
	return {
		droneSn,
		online: true,
		flying: false,
		mode: "idle",
		battery: 95,
		speed: 0,
		lastSeenAt: Date.now(),
		source: DEV_STUB_MARKER,
	};
}

export function devStubMissionStatus(missionId: string): StubMarked<MissionStatus> {
	return {
		missionId,
		status: "completed",
		progress: 100,
		source: DEV_STUB_MARKER,
	};
}

export function devStubPreflight(airportId: string): StubMarked<PreflightResult> {
	return {
		airportId,
		passed: true,
		checks: [
			{ name: "dock_online", passed: true },
			{ name: "drone_bound", passed: true },
			{ name: "battery", passed: true, detail: "92%" },
			{ name: "gps_fix", passed: true },
		],
		message: "All checks passed (DEV STUB)",
		source: DEV_STUB_MARKER,
	};
}
