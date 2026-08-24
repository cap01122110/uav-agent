/**
 * Pi event adapter.
 *
 * Maps pi AgentSessionEvent into the UAV event protocol. This is the only
 * place where pi event types are translated; UI adapters never see them.
 *
 * Note on `message.delta`: pi streams whole-message snapshots (message_update),
 * not character deltas. The mapper emits the current full text as a delta
 * event; adapters replace the rendered text instead of appending.
 */

import { contentText } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { UavAgentEvent } from "./events.ts";

/** Map one pi session event into zero or more UAV events. */
export function mapPiEvent(event: AgentSessionEvent): UavAgentEvent[] {
	switch (event.type) {
		case "agent_start":
			return [{ type: "turn.started" }];
		case "agent_end":
			return [{ type: "turn.completed" }];
		case "message_update":
			if (event.message.role === "assistant") {
				return [{ type: "message.delta", content: contentText(event.message.content) }];
			}
			return [];
		case "message_end":
			if (event.message.role === "assistant") {
				return [{ type: "message.completed", content: contentText(event.message.content) }];
			}
			return [];
		case "tool_execution_start":
			return [
				{
					type: "tool.started",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					input: event.args,
				},
			];
		case "tool_execution_end":
			return [
				{
					type: "tool.completed",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					result: event.result,
					isError: event.isError,
				},
			];
		default:
			// User message lifecycle, compaction, queue updates and other
			// pi-internal events are not part of the UAV protocol yet.
			return [];
	}
}
