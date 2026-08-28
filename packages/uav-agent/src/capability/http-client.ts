/**
 * HttpUavCapabilityClient - HTTP-backed implementation of UavCapabilityClient.
 *
 * A thin adapter over the existing UavPlatformClient: it only forwards each
 * capability call to the matching platform sub-api. It does not swallow or
 * re-wrap errors (PlatformError propagates unchanged), does not alter result
 * fields, and does not duplicate platform logic (pagination, workspace
 * resolution, auth, fail-closed preflight composition all stay in platform/*).
 */

import type { UavPlatformClient } from "../platform/client.ts";
import type { UavCapabilityClient } from "./client.ts";
import type {
	AirportStatus,
	DroneStatus,
	GetAirportStatusInput,
	GetDroneStatusInput,
	GetMissionStatusInput,
	MissionStatus,
	PreflightCheckInput,
	PreflightResult,
	ResolveAirportInput,
	ResolvedAirport,
} from "./types.ts";

export class HttpUavCapabilityClient implements UavCapabilityClient {
	private readonly platform: UavPlatformClient;

	constructor(platform: UavPlatformClient) {
		this.platform = platform;
	}

	resolveAirport(input: ResolveAirportInput, signal?: AbortSignal): Promise<ResolvedAirport> {
		return this.platform.airport.resolve(input.airportId, signal);
	}

	getAirportStatus(input: GetAirportStatusInput, signal?: AbortSignal): Promise<AirportStatus> {
		return this.platform.airport.getStatus(input.airportId, signal);
	}

	getDroneStatus(input: GetDroneStatusInput, signal?: AbortSignal): Promise<DroneStatus> {
		return this.platform.drone.getStatus(input.droneSn, signal);
	}

	getMissionStatus(input: GetMissionStatusInput, signal?: AbortSignal): Promise<MissionStatus> {
		return this.platform.mission.getStatus(input.missionId, signal);
	}

	preflightCheck(input: PreflightCheckInput, signal?: AbortSignal): Promise<PreflightResult> {
		return this.platform.safety.preflightCheck(input.airportId, signal);
	}
}
