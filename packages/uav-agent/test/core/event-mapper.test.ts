import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { mapPiEvent } from "../../src/core/event-mapper.ts";

function asEvent(event: Record<string, unknown>): AgentSessionEvent {
	return event as unknown as AgentSessionEvent;
}

describe("mapPiEvent", () => {
	it("maps agent_start to turn.started", () => {
		expect(mapPiEvent(asEvent({ type: "agent_start" }))).toEqual([{ type: "turn.started" }]);
	});

	it("maps agent_end to turn.completed", () => {
		expect(mapPiEvent(asEvent({ type: "agent_end", messages: [] }))).toEqual([{ type: "turn.completed" }]);
	});

	it("maps assistant message_update to message.delta with full text", () => {
		const event = asEvent({
			type: "message_update",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "机场 Test-01 状态正常" }],
			},
			assistantMessageEvent: {},
		});
		expect(mapPiEvent(event)).toEqual([{ type: "message.delta", content: "机场 Test-01 状态正常" }]);
	});

	it("joins multi-part assistant content into one delta", () => {
		const event = asEvent({
			type: "message_update",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "状态:" },
					{ type: "text", text: "在线" },
				],
			},
			assistantMessageEvent: {},
		});
		expect(mapPiEvent(event)).toEqual([{ type: "message.delta", content: "状态:\n在线" }]);
	});

	it("ignores non-assistant message_update", () => {
		const event = asEvent({
			type: "message_update",
			message: { role: "user", content: [{ type: "text", text: "hi" }] },
			assistantMessageEvent: {},
		});
		expect(mapPiEvent(event)).toEqual([]);
	});

	it("maps assistant message_end to message.completed", () => {
		const event = asEvent({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "完成" }],
			},
		});
		expect(mapPiEvent(event)).toEqual([{ type: "message.completed", content: "完成" }]);
	});

	it("maps tool_execution_start to tool.started", () => {
		const event = asEvent({
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "get_airport_status",
			args: { airport: "Test-01" },
		});
		expect(mapPiEvent(event)).toEqual([
			{
				type: "tool.started",
				toolCallId: "call-1",
				toolName: "get_airport_status",
				input: { airport: "Test-01" },
			},
		]);
	});

	it("maps tool_execution_end to tool.completed with isError", () => {
		const event = asEvent({
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "get_airport_status",
			result: { content: [] },
			isError: false,
		});
		expect(mapPiEvent(event)).toEqual([
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
		expect(mapPiEvent(asEvent({ type: "compaction_start", reason: "threshold" }))).toEqual([]);
		expect(mapPiEvent(asEvent({ type: "queue_update", steering: [], followUp: [] }))).toEqual([]);
		expect(mapPiEvent(asEvent({ type: "entry_appended", entry: { type: "message", id: "1" } }))).toEqual([]);
	});
});
