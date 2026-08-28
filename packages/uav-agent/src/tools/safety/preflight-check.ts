/**
 * preflight_check tool.
 *
 * Runs a deterministic read-only safety check for an airport before a flight:
 * airport online, airport idle (no running/paused job), drone bound. The
 * docked drone's online state is reported informationally only — it never
 * gates the verdict. Results come from the platform, never guessed by the
 * model.
 */

import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import type { UavCapabilityClient } from "../../capability/client.ts";

export const preflightCheckInput = Type.Object({
	airportId: Type.String({ description: "机场 SN 或名称,例如 Test-01" }),
});

export type PreflightCheckToolInput = Static<typeof preflightCheckInput>;

export function preflightCheckTool(capabilities: UavCapabilityClient): ToolDefinition {
	return defineTool({
		name: "preflight_check",
		label: "Preflight Check",
		description:
			"对指定机场执行起飞前安全检查(只读)。确认:机场存在、机场在线、机场明确空闲(无运行中或暂停任务)、已绑定无人机、关键状态可确认(未知状态按未通过处理)。返回的 passed 字段是飞前检查的最终结论。绑定无人机的在线状态可能作为 informational 提示项返回,仅用于展示,机场内无人机离线不单独导致检查失败,请直接依据 passed 回答,不要因 informational 项推翻结论或追加查询其它状态工具。",
		parameters: preflightCheckInput,
		async execute(_toolCallId, params, signal) {
			const result = await capabilities.preflightCheck({ airportId: params.airportId }, signal);
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
