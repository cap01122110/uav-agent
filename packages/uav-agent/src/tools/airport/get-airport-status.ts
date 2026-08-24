/**
 * get_airport_status tool.
 *
 * Queries the real-time status of one airport (dock) from the business
 * platform. Status is never guessed by the model; it comes from the platform
 * through UavPlatformClient.
 */

import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import type { UavPlatformClient } from "../../platform/client.ts";

export const getAirportStatusInput = Type.Object({
	airportId: Type.String({ description: "机场 SN,例如 Test-01" }),
});

export type AirportStatusToolInput = Static<typeof getAirportStatusInput>;

export function getAirportStatusTool(platform: UavPlatformClient): ToolDefinition {
	return defineTool({
		name: "get_airport_status",
		label: "Get Airport Status",
		description: "查询指定机场(机场/停机坪)的实时状态,包括在线状态、电量、信号、是否绑定无人机等。",
		parameters: getAirportStatusInput,
		async execute(_toolCallId, params, signal) {
			const status = await platform.airport.getStatus(params.airportId, signal);
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
