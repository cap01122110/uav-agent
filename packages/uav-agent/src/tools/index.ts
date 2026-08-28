/**
 * UAV tools.
 *
 * Tools are business-capability shaped (get_airport_status), not REST-controller
 * shaped. Each tool validates its input schema, calls the platform client, and
 * returns a stable result. No tool calls fetch() directly.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { UavCapabilityClient } from "../capability/client.ts";
import { createPrepareActionTools, type PrepareActionContext } from "./actions/prepare-actions.ts";
import { getAirportStatusTool } from "./airport/get-airport-status.ts";
import { resolveAirportTool } from "./airport/resolve-airport.ts";
import { getDroneStatusTool } from "./drone/get-drone-status.ts";
import { getMissionStatusTool } from "./mission/get-mission-status.ts";
import { preflightCheckTool } from "./safety/preflight-check.ts";

export type { AirportStatusToolInput } from "./airport/get-airport-status.ts";
export type { ResolveAirportToolInput } from "./airport/resolve-airport.ts";
export type { DroneStatusToolInput } from "./drone/get-drone-status.ts";
export type { MissionStatusToolInput } from "./mission/get-mission-status.ts";
export type { PreflightCheckToolInput } from "./safety/preflight-check.ts";

/** Register all UAV tools against one capability client and confirmation context. */
export function createUavTools(capabilities: UavCapabilityClient, actions?: PrepareActionContext): ToolDefinition[] {
	return [
		getAirportStatusTool(capabilities),
		resolveAirportTool(capabilities),
		getDroneStatusTool(capabilities),
		getMissionStatusTool(capabilities),
		preflightCheckTool(capabilities),
		...(actions !== undefined ? createPrepareActionTools(actions) : []),
	];
}
