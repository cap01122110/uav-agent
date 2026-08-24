/**
 * Prepare-action tools.
 *
 * These tools only create a WAITING_CONFIRMATION action; they NEVER execute
 * flight control. After the user confirms (via the UI), the future executor
 * runs the deterministic operation. The model cannot bypass confirmation.
 */

import { Type } from "@earendil-works/pi-ai";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { PrepareActionInput } from "../../actions/action-service.ts";
import type { UavAction } from "../../actions/types.ts";

export interface PrepareActionContext {
	prepareAction(sessionId: string, input: PrepareActionInput): Promise<UavAction>;
}

function sessionIdOf(ctx: ExtensionContext): string {
	return ctx.sessionManager.getSessionId();
}

const returnHomeInput = Type.Object({
	dockSn: Type.String({ description: "机场 SN,例如 8UUXN7N00A0G5T" }),
});

const pointFlightInput = Type.Object({
	dockSn: Type.String({ description: "机场 SN" }),
	latitude: Type.Number({ description: "目标纬度" }),
	longitude: Type.Number({ description: "目标经度" }),
	altitude: Type.Optional(Type.Number({ description: "目标高度(米)" })),
});

const startLiveInput = Type.Object({
	dockSn: Type.String({ description: "机场 SN" }),
	streamUrl: Type.Optional(Type.String({ description: "直播推流地址(可选)" })),
});

/** Register the prepare-only action tools against a confirmation context. */
export function createPrepareActionTools(ctx: PrepareActionContext): ToolDefinition[] {
	const returnHome = defineTool({
		name: "prepare_return_home",
		label: "Prepare Return Home",
		description: "创建返航动作并等待用户确认。只注册待确认动作,不会执行任何飞控操作。用户确认后才会执行。",
		parameters: returnHomeInput,
		async execute(_toolCallId, params, _signal, _onUpdate, extensionCtx) {
			const action = await ctx.prepareAction(sessionIdOf(extensionCtx), {
				type: "return_home",
				summary: `返航:机场 ${params.dockSn}`,
				payload: { dockSn: params.dockSn },
			});
			return {
				content: [{ type: "text", text: actionSummary(action) }],
				details: { actionId: action.id, status: action.status },
			};
		},
	});

	const pointFlight = defineTool({
		name: "prepare_point_flight",
		label: "Prepare Point Flight",
		description: "创建指点飞行动作并等待用户确认。只注册待确认动作,不会执行任何飞控操作。用户确认后才会执行。",
		parameters: pointFlightInput,
		async execute(_toolCallId, params, _signal, _onUpdate, extensionCtx) {
			const action = await ctx.prepareAction(sessionIdOf(extensionCtx), {
				type: "point_flight",
				summary: `指点飞行:机场 ${params.dockSn} → (${params.latitude}, ${params.longitude})${params.altitude !== undefined ? ` @${params.altitude}m` : ""}`,
				payload: {
					dockSn: params.dockSn,
					latitude: params.latitude,
					longitude: params.longitude,
					altitude: params.altitude,
				},
			});
			return {
				content: [{ type: "text", text: actionSummary(action) }],
				details: { actionId: action.id, status: action.status },
			};
		},
	});

	const startLive = defineTool({
		name: "prepare_start_live",
		label: "Prepare Start Live",
		description: "创建开启直播动作并等待用户确认。只注册待确认动作,不会执行任何操作。用户确认后才会执行。",
		parameters: startLiveInput,
		async execute(_toolCallId, params, _signal, _onUpdate, extensionCtx) {
			const action = await ctx.prepareAction(sessionIdOf(extensionCtx), {
				type: "start_live",
				summary: `开启直播:机场 ${params.dockSn}`,
				payload: { dockSn: params.dockSn, streamUrl: params.streamUrl },
			});
			return {
				content: [{ type: "text", text: actionSummary(action) }],
				details: { actionId: action.id, status: action.status },
			};
		},
	});

	return [returnHome, pointFlight, startLive];
}

function actionSummary(action: UavAction): string {
	return `动作已创建并等待确认:\n- actionId: ${action.id}\n- 类型: ${action.type}\n- 摘要: ${action.summary}\n- 状态: ${action.status}\n请告知用户使用 /confirm ${action.id.slice(0, 8)} 确认,或 /cancel ${action.id.slice(0, 8)} 取消。`;
}
