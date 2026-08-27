/**
 * ChatView presentation-state behavior tests.
 *
 * These exercise the real pi-tui component tree via container.render(width)
 * and assert on the resulting ANSI lines.
 */
import { describe, expect, it } from "vitest";
import { ChatView } from "../../../src/adapters/tui/chat-view.ts";

const WIDTH = 80;

function renderLines(view: ChatView): string[] {
	return view.container.render(WIDTH);
}

/** All rendered lines joined, with padding trimmed per line for substring assertions. */
function renderText(view: ChatView): string {
	return renderLines(view)
		.map((line) => line.replace(/\s+$/, ""))
		.join("\n");
}

describe("ChatView user messages", () => {
	it("renders 你 frame instead of You:", () => {
		const view = new ChatView(WIDTH);
		view.addUserMessage("查询 Test-01 当前状态");
		const text = renderText(view);
		expect(text).toContain("┌─ 你");
		expect(text).toContain("查询 Test-01 当前状态");
		expect(text).not.toContain("You:");
	});

	it("renders multi-line user input one bordered line per source line", () => {
		const view = new ChatView(WIDTH);
		view.addUserMessage("第一行\n第二行");
		const text = renderText(view);
		expect(text).toContain("第一行");
		expect(text).toContain("第二行");
		// Exactly one frame: single top and bottom border.
		expect(text.match(/┌─ 你/g)).toHaveLength(1);
		expect(text.match(/└/g)).toHaveLength(1);
	});
});

describe("ChatView assistant streaming", () => {
	it("creates a single assistant block for many deltas with one header", () => {
		const view = new ChatView(WIDTH);
		view.renderEvent({ type: "message.delta", content: "我" });
		view.renderEvent({ type: "message.delta", content: "来帮你" });
		view.renderEvent({ type: "message.delta", content: "查询" });
		const text = renderText(view);
		expect(text).toContain("◆ UAV Agent");
		expect(text).toContain("我来帮你查询");
		expect(text.match(/◆ UAV Agent/g)).toHaveLength(1);
	});

	it("message.completed replaces streaming content exactly once", () => {
		const view = new ChatView(WIDTH);
		view.renderEvent({ type: "message.delta", content: "部分" });
		view.renderEvent({ type: "message.completed", content: "完整回复内容" });
		const text = renderText(view);
		expect(text).toContain("完整回复内容");
		expect(text).not.toContain("部分");
		expect(text.match(/◆ UAV Agent/g)).toHaveLength(1);
	});

	it("a new user message closes the assistant block so the next reply gets a fresh header", () => {
		const view = new ChatView(WIDTH);
		view.renderEvent({ type: "message.completed", content: "第一条回复" });
		view.addUserMessage("第二个问题");
		view.renderEvent({ type: "message.delta", content: "第二条回复" });
		const text = renderText(view);
		expect(text.match(/◆ UAV Agent/g)).toHaveLength(2);
		expect(text).toContain("第二个问题");
	});

	it("separates turns with a dim rule before each new user message", () => {
		const view = new ChatView(WIDTH);
		view.renderEvent({ type: "message.completed", content: "第一条回复" });
		view.addUserMessage("第二个问题");
		const lines = renderLines(view);
		expect(lines.some((line) => line.includes("─".repeat(8)))).toBe(true);
	});
});

describe("ChatView tool activity", () => {
	it("tool start and completion share one line keyed by toolCallId", () => {
		const view = new ChatView(WIDTH);
		view.renderEvent({ type: "tool.started", toolCallId: "call-1", toolName: "resolve_airport" });
		view.renderEvent({
			type: "tool.completed",
			toolCallId: "call-1",
			toolName: "resolve_airport",
			isError: false,
		});
		const text = renderText(view);
		// The running marker is gone: completed replaced it in place.
		expect(text).toContain("✓ resolve_airport");
		expect(text.match(/resolve_airport/g)).toHaveLength(1);
	});

	it("failures render the red failure marker", () => {
		const view = new ChatView(WIDTH);
		view.renderEvent({ type: "tool.started", toolCallId: "call-1", toolName: "preflight_check" });
		view.renderEvent({
			type: "tool.completed",
			toolCallId: "call-1",
			toolName: "preflight_check",
			isError: true,
		});
		const text = renderText(view);
		expect(text).toContain("✗ preflight_check");
		expect(text).not.toContain("✓ preflight_check");
	});

	it("same tool called twice keeps independent states", () => {
		const view = new ChatView(WIDTH);
		view.renderEvent({ type: "tool.started", toolCallId: "call-1", toolName: "get_drone_status" });
		view.renderEvent({ type: "tool.started", toolCallId: "call-2", toolName: "get_drone_status" });
		view.renderEvent({
			type: "tool.completed",
			toolCallId: "call-1",
			toolName: "get_drone_status",
			isError: false,
		});
		const text = renderText(view);
		// First call completed, second still running — statuses must not mix.
		expect(text.match(/✓ get_drone_status/g)).toHaveLength(1);
		expect(text.match(/↳ get_drone_status/g)).toHaveLength(1);
	});

	it("completion for an unknown toolCallId does not crash or render", () => {
		const view = new ChatView(WIDTH);
		expect(() =>
			view.renderEvent({ type: "tool.completed", toolCallId: "ghost", toolName: "x", isError: true }),
		).not.toThrow();
		expect(renderText(view)).not.toContain("✗ x");
	});
});

describe("ChatView errors and confirmations", () => {
	it("renders errors with code and message and keeps rendering after them", () => {
		const view = new ChatView(WIDTH);
		view.renderEvent({ type: "error", code: "PLATFORM_UNAVAILABLE", message: "UAV platform is unavailable" });
		view.renderEvent({ type: "message.delta", content: "恢复后的回复" });
		const text = renderText(view);
		expect(text).toContain("✗ Error [PLATFORM_UNAVAILABLE]");
		expect(text).toContain("UAV platform is unavailable");
		// Rendering continues after the error block.
		expect(text).toContain("◆ UAV Agent");
		expect(text).toContain("恢复后的回复");
	});

	it("renders confirmation with type, summary and command hints", () => {
		const view = new ChatView(WIDTH);
		view.renderEvent({
			type: "action.confirmation_required",
			actionId: "full-uuid-action-id",
			actionType: "return_home",
			summary: "返航 Test-01",
		});
		const text = renderText(view);
		expect(text).toContain("⚠ 需要确认");
		expect(text).toContain("return_home: 返航 Test-01");
		expect(text).toContain("/confirm full-uu");
		expect(text).toContain("/cancel full-uu");
	});
});
