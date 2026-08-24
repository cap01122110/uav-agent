/**
 * resolve_airport tool.
 *
 * Resolves an airport identifier (SN, nickname or device name) to its
 * canonical device SN and display name, from the real platform.
 */

import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import type { UavPlatformClient } from "../../platform/client.ts";

export const resolveAirportInput = Type.Object({
	airportId: Type.String({ description: "机场标识:SN、昵称或设备名称" }),
});

export type ResolveAirportToolInput = Static<typeof resolveAirportInput>;

export function resolveAirportTool(platform: UavPlatformClient): ToolDefinition {
	return defineTool({
		name: "resolve_airport",
		label: "Resolve Airport",
		description: "将机场标识(SN、昵称或设备名称)解析为机场的设备 SN 和显示名称。",
		parameters: resolveAirportInput,
		async execute(_toolCallId, params, signal) {
			const resolved = await platform.airport.resolve(params.airportId, signal);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(resolved, null, 2),
					},
				],
				details: resolved,
			};
		},
	});
}
