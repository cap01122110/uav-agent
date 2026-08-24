/**
 * get_mission_status tool.
 *
 * Queries the status of one wayline mission (job) from the business platform.
 */

import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import type { UavPlatformClient } from "../../platform/client.ts";

export const getMissionStatusInput = Type.Object({
	missionId: Type.String({ description: "任务 ID 或任务名称" }),
});

export type MissionStatusToolInput = Static<typeof getMissionStatusInput>;

export function getMissionStatusTool(platform: UavPlatformClient): ToolDefinition {
	return defineTool({
		name: "get_mission_status",
		label: "Get Mission Status",
		description: "查询指定飞行任务(航线任务)的状态,包括执行中/已完成/失败/取消等状态、进度、起止时间。",
		parameters: getMissionStatusInput,
		async execute(_toolCallId, params, signal) {
			const status = await platform.mission.getStatus(params.missionId, signal);
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
