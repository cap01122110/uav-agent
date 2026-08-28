/**
 * UavCapabilityClient - the stable domain capability surface tools depend on.
 *
 * Tools never know which transport backs these calls. Today the only
 * implementation is HttpUavCapabilityClient (over UavPlatformClient); a future
 * GrpcUavCapabilityClient implements the same interface without touching tools
 * or the tool factory.
 *
 * Every method accepts a domain request object and an optional AbortSignal and
 * resolves to a domain result. Failures are normalized to PlatformError by the
 * transport-specific implementation and propagate unchanged; this interface
 * defines no error type of its own.
 */

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

export interface UavCapabilityClient {
	/** Resolve an airport identifier (SN, nickname or device name) to its device SN. */
	resolveAirport(input: ResolveAirportInput, signal?: AbortSignal): Promise<ResolvedAirport>;
	/** Query one airport (dock) status by its SN. */
	getAirportStatus(input: GetAirportStatusInput, signal?: AbortSignal): Promise<AirportStatus>;
	/** Query one drone's status by its SN. */
	getDroneStatus(input: GetDroneStatusInput, signal?: AbortSignal): Promise<DroneStatus>;
	/** Query one wayline mission's status by its id or name. */
	getMissionStatus(input: GetMissionStatusInput, signal?: AbortSignal): Promise<MissionStatus>;
	/** Run the read-only preflight safety check for an airport. */
	preflightCheck(input: PreflightCheckInput, signal?: AbortSignal): Promise<PreflightResult>;
}
