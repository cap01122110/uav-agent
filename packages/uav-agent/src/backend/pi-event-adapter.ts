/**
 * Pi event adapter.
 *
 * Maps pi AgentSessionEvent into the UAV event protocol. This is the only
 * place where pi event types are translated; UI adapters never see them.
 *
 * Semantics:
 * - turn_start/turn_end map to turn.started/turn.completed. The larger
 *   agent_start/agent_end (a whole agent run spanning multiple turns) is not
 *   a single turn and is not mapped to turn events.
 * - message.delta carries the real incremental text; the adapter tracks the
 *   previous assistant text and only emits the added suffix. When a diff is
 *   impossible (text replaced entirely), the full text is emitted as a delta.
 * - message.completed carries the final full assistant text.
 */

import { contentText } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { UavAgentEvent } from "../core/events.ts";

export class PiEventAdapter {
	private lastAssistantText: string | undefined;

	/** Start of a new assistant message: reset diff tracking. */
	beginAssistant(): void {
		this.lastAssistantText = undefined;
	}

	/** Map one pi session event into zero or more UAV events. */
	map(event: AgentSessionEvent): UavAgentEvent[] {
		switch (event.type) {
			case "turn_start":
				return [{ type: "turn.started" }];
			case "turn_end":
				return [{ type: "turn.completed" }];
			case "message_start":
				if (event.message.role === "assistant") {
					this.beginAssistant();
				}
				return [];
			case "message_update":
				if (event.message.role === "assistant") {
					const text = contentText(event.message.content);
					const delta = this.computeDelta(text);
					if (delta.length === 0) return [];
					return [{ type: "message.delta", content: delta }];
				}
				return [];
			case "message_end":
				if (event.message.role === "assistant") {
					this.beginAssistant();
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

	/** Emit only the added suffix when the new text extends the previous one. */
	private computeDelta(text: string): string {
		const previous = this.lastAssistantText;
		if (previous !== undefined && text.startsWith(previous)) {
			this.lastAssistantText = text;
			return text.slice(previous.length);
		}
		// No extendable prefix (replaced or first chunk): emit the full text.
		this.lastAssistantText = text;
		return text;
	}
}
