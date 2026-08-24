/**
 * UAV tools.
 *
 * Tools are business-capability shaped (get_airport_status), not REST-controller
 * shaped. Each tool validates its input schema, calls the platform client, and
 * returns a stable result. No tool calls fetch() directly.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { UavPlatformClient } from "../platform/client.ts";
import { createPrepareActionTools, type PrepareActionContext } from "./actions/prepare-actions.ts";
import { getAirportStatusTool } from "./airport/get-airport-status.ts";
import { getDroneStatusTool } from "./drone/get-drone-status.ts";
import { getMissionStatusTool } from "./mission/get-mission-status.ts";
import { preflightCheckTool } from "./safety/preflight-check.ts";

export type { AirportStatusToolInput } from "./airport/get-airport-status.ts";
export type { DroneStatusToolInput } from "./drone/get-drone-status.ts";
export type { MissionStatusToolInput } from "./mission/get-mission-status.ts";
export type { PreflightCheckToolInput } from "./safety/preflight-check.ts";

/** Register all UAV tools against one platform client and confirmation context. */
export function createUavTools(platform: UavPlatformClient, actions?: PrepareActionContext): ToolDefinition[] {
	return [
		getAirportStatusTool(platform),
		getDroneStatusTool(platform),
		getMissionStatusTool(platform),
		preflightCheckTool(platform),
		...(actions !== undefined ? createPrepareActionTools(actions) : []),
	];
}
