/**
 * UAV capability domain types.
 *
 * The capability surface is domain-shaped, not HTTP-shaped: inputs are
 * domain requests (airport id, drone SN, mission id), results are the stable
 * domain types already produced by the platform adapter. Transport details
 * (workspace ids, pagination, envelopes, DJI numeric statuses) never appear
 * here.
 */

export interface ResolveAirportInput {
	airportId: string;
}

export interface GetAirportStatusInput {
	airportId: string;
}

export interface GetDroneStatusInput {
	droneSn: string;
}

export interface GetMissionStatusInput {
	missionId: string;
}

export interface PreflightCheckInput {
	airportId: string;
}

export type {
	AirportStatus,
	DroneStatus,
	GpsPosition,
	MissionStatus,
	MissionStatusValue,
	PreflightCheck,
	PreflightResult,
	ResolvedAirport,
} from "../platform/types.ts";
