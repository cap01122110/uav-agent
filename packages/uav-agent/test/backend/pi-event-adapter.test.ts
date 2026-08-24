import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PiEventAdapter } from "../../src/backend/pi-event-adapter.ts";

function asEvent(event: Record<string, unknown>): AgentSessionEvent {
	return event as unknown as AgentSessionEvent;
}

describe("PiEventAdapter", () => {
	it("maps turn_start/turn_end, not agent_start/agent_end", () => {
		const adapter = new PiEventAdapter();
		expect(adapter.map(asEvent({ type: "turn_start" }))).toEqual([{ type: "turn.started" }]);
		expect(adapter.map(asEvent({ type: "turn_end", message: {}, toolResults: [] }))).toEqual([
			{ type: "turn.completed" },
		]);
		// A whole agent run is not a single turn.
		expect(adapter.map(asEvent({ type: "agent_start" }))).toEqual([]);
		expect(adapter.map(asEvent({ type: "agent_end", messages: [] }))).toEqual([]);
	});

	it("emits real incremental deltas for assistant streaming", () => {
		const adapter = new PiEventAdapter();
		adapter.map(asEvent({ type: "message_start", message: { role: "assistant", content: [] } }));
		expect(
			adapter.map(
				asEvent({
					type: "message_update",
					message: { role: "assistant", content: [{ type: "text", text: "Test-01 " }] },
					assistantMessageEvent: {},
				}),
			),
		).toEqual([{ type: "message.delta", content: "Test-01 " }]);
		expect(
			adapter.map(
				asEvent({
					type: "message_update",
					message: { role: "assistant", content: [{ type: "text", text: "Test-01 在线" }] },
					assistantMessageEvent: {},
				}),
			),
		).toEqual([{ type: "message.delta", content: "在线" }]);
	});

	it("falls back to full text when the update is not an extension", () => {
		const adapter = new PiEventAdapter();
		adapter.map(asEvent({ type: "message_start", message: { role: "assistant", content: [] } }));
		adapter.map(
			asEvent({
				type: "message_update",
				message: { role: "assistant", content: [{ type: "text", text: "旧文本" }] },
				assistantMessageEvent: {},
			}),
		);
		expect(
			adapter.map(
				asEvent({
					type: "message_update",
					message: { role: "assistant", content: [{ type: "text", text: "全新文本" }] },
					assistantMessageEvent: {},
				}),
			),
		).toEqual([{ type: "message.delta", content: "全新文本" }]);
	});

	it("maps message_end to message.completed with full text", () => {
		const adapter = new PiEventAdapter();
		adapter.map(asEvent({ type: "message_start", message: { role: "assistant", content: [] } }));
		expect(
			adapter.map(
				asEvent({
					type: "message_end",
					message: { role: "assistant", content: [{ type: "text", text: "完成" }] },
				}),
			),
		).toEqual([{ type: "message.completed", content: "完成" }]);
	});

	it("ignores non-assistant message events", () => {
		const adapter = new PiEventAdapter();
		expect(
			adapter.map(
				asEvent({
					type: "message_update",
					message: { role: "user", content: [{ type: "text", text: "hi" }] },
					assistantMessageEvent: {},
				}),
			),
		).toEqual([]);
	});

	it("maps tool execution lifecycle", () => {
		const adapter = new PiEventAdapter();
		expect(
			adapter.map(
				asEvent({
					type: "tool_execution_start",
					toolCallId: "call-1",
					toolName: "get_airport_status",
					args: { airport: "Test-01" },
				}),
			),
		).toEqual([
			{
				type: "tool.started",
				toolCallId: "call-1",
				toolName: "get_airport_status",
				input: { airport: "Test-01" },
			},
		]);
		expect(
			adapter.map(
				asEvent({
					type: "tool_execution_end",
					toolCallId: "call-1",
					toolName: "get_airport_status",
					result: { content: [] },
					isError: false,
				}),
			),
		).toEqual([
			{
				type: "tool.completed",
				toolCallId: "call-1",
				toolName: "get_airport_status",
				result: { content: [] },
				isError: false,
			},
		]);
	});

	it("ignores pi-internal events", () => {
		const adapter = new PiEventAdapter();
		expect(adapter.map(asEvent({ type: "compaction_start", reason: "threshold" }))).toEqual([]);
		expect(adapter.map(asEvent({ type: "queue_update", steering: [], followUp: [] }))).toEqual([]);
	});
});
