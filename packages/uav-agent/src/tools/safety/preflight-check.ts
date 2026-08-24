/**
 * preflight_check tool.
 *
 * Runs a deterministic read-only safety check for an airport before a flight:
 * airport online, drone bound, drone online. Results come from the platform,
 * never guessed by the model.
 */

import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import type { UavPlatformClient } from "../../platform/client.ts";

export const preflightCheckInput = Type.Object({
	airportId: Type.String({ description: "机场 SN 或名称,例如 Test-01" }),
});

export type PreflightCheckToolInput = Static<typeof preflightCheckInput>;

export function preflightCheckTool(platform: UavPlatformClient): ToolDefinition {
	return defineTool({
		name: "preflight_check",
		label: "Preflight Check",
		description:
			"对指定机场执行起飞前安全检查(只读):机场在线、已绑定无人机、无人机在线。任何一项不满足则返回未通过。",
		parameters: preflightCheckInput,
		async execute(_toolCallId, params, signal) {
			const result = await platform.safety.preflightCheck(params.airportId, signal);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(result, null, 2),
					},
				],
				details: result,
			};
		},
	});
}
