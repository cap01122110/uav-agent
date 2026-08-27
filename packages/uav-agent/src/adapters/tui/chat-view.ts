/**
 * Chat view - renders UAV events into terminal components.
 *
 * Pure rendering: no business logic, no platform knowledge. It only consumes
 * UavAgentEvent values and produces TUI components.
 *
 * State kept here is presentation-only:
 * - one AssistantMessageComponent per assistant message (streaming updates it
 *   in place, so the identity header never repeats per delta)
 * - one ToolActivityComponent per toolCallId (start/completed share one line)
 */
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import type { UavAgentEvent } from "../../core/events.ts";
import { AssistantMessageComponent } from "./components/assistant-message.ts";
import { ConfirmationComponent, ErrorComponent, separatorLine } from "./components/notices.ts";
import { STYLES } from "./components/styles.ts";
import { ToolActivityComponent } from "./components/tool-activity.ts";
import { UserMessageComponent } from "./components/user-message.ts";

export { STYLES };

/** Approximate terminal width used to wrap user input before the first render. */
const DEFAULT_WIDTH = 80;
/** Blank lines inserted between conversation blocks. */
const BLOCK_GAP = 1;

export class ChatView {
	/** Container added to the TUI; messages are appended to it. */
	readonly container = new Container();
	private assistant: AssistantMessageComponent | undefined;
	private assistantBuffer = "";
	/** Tool lines keyed by toolCallId so start/completed share one row. */
	private readonly tools = new Map<string, ToolActivityComponent>();
	private readonly width: number;

	constructor(width: number = DEFAULT_WIDTH) {
		this.width = width;
	}

	addUserMessage(content: string): void {
		this.finishAssistant();
		// Turn boundary: dim rule before each new user message once there is
		// prior content. Intentionally not tied to message.completed — the run
		// lifecycle may span several messages.
		if (this.container.children.length > 0) {
			this.container.addChild(separatorLine(this.width));
		}
		this.container.addChild(new UserMessageComponent(content, this.width));
	}

	/** Append a streaming delta to the current assistant message. */
	appendAssistantDelta(delta: string): void {
		this.assistantBuffer += delta;
		this.updateAssistant(this.assistantBuffer);
	}

	/** Replace the assistant message with the final full text. */
	completeAssistant(content: string): void {
		this.assistantBuffer = content;
		this.updateAssistant(content);
		this.finishAssistant();
	}

	private updateAssistant(content: string): void {
		if (this.assistant === undefined) {
			this.assistant = new AssistantMessageComponent(content);
			this.container.addChild(this.assistant);
			return;
		}
		this.assistant.setContent(content);
	}

	private finishAssistant(): void {
		this.assistant = undefined;
		this.assistantBuffer = "";
	}

	startTool(toolCallId: string, toolName: string): void {
		// A restarted id replaces its line rather than stacking a duplicate.
		const existing = this.tools.get(toolCallId);
		if (existing !== undefined) {
			this.container.removeChild(existing);
		}
		const component = new ToolActivityComponent(toolCallId, toolName);
		this.tools.set(toolCallId, component);
		this.container.addChild(component);
	}

	completeTool(toolCallId: string, _toolName: string, isError?: boolean): void {
		this.tools.get(toolCallId)?.complete(isError === true);
	}

	addError(code: string, message: string): void {
		this.gap();
		this.container.addChild(new ErrorComponent(code, message));
	}

	addInfo(text: string): void {
		this.container.addChild(new Text(text, 1, 0));
	}

	private gap(): void {
		if (this.container.children.length === 0) return;
		this.container.addChild(new Spacer(BLOCK_GAP));
	}

	renderEvent(event: UavAgentEvent): void {
		switch (event.type) {
			case "message.delta":
				this.appendAssistantDelta(event.content);
				break;
			case "message.completed":
				this.completeAssistant(event.content);
				break;
			case "tool.started":
				this.startTool(event.toolCallId, event.toolName);
				break;
			case "tool.completed":
				this.completeTool(event.toolCallId, event.toolName, event.isError);
				break;
			case "error":
				this.addError(event.code, event.message);
				break;
			case "turn.started":
			case "turn.completed":
				break;
			case "action.confirmation_required":
				this.gap();
				this.container.addChild(new ConfirmationComponent(event.actionType, event.summary, event.actionId));
				break;
			case "action.started":
			case "action.completed":
				break;
		}
	}
}
