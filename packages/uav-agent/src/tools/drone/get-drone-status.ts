/**
 * get_drone_status tool.
 *
 * Queries the real-time status of one drone by its SN from the business
 * platform through UavPlatformClient.
 */

import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import type { UavPlatformClient } from "../../platform/client.ts";

export const getDroneStatusInput = Type.Object({
	droneSn: Type.String({ description: "无人机 SN,例如 1581F8HGX255U00A0GGV" }),
});

export type DroneStatusToolInput = Static<typeof getDroneStatusInput>;

export function getDroneStatusTool(platform: UavPlatformClient): ToolDefinition {
	return defineTool({
		name: "get_drone_status",
		label: "Get Drone Status",
		description: "查询指定无人机的实时状态,包括在线状态、型号、绑定关系、最后在线时间等。",
		parameters: getDroneStatusInput,
		async execute(_toolCallId, params, signal) {
			const status = await platform.drone.getStatus(params.droneSn, signal);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(status, null, 2),
					},
				],
				details: status,
			};
		},
	});
}
