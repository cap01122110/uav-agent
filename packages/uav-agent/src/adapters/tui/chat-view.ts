/**
 * Chat view - renders UAV events into terminal components.
 *
 * Pure rendering: no business logic, no platform knowledge. It only consumes
 * UavAgentEvent values and produces TUI components.
 */

import { Container, Text } from "@earendil-works/pi-tui";
import type { UavAgentEvent } from "../../core/events.ts";

export const STYLES = {
	user: (text: string) => `\x1b[36m${text}\x1b[0m`,
	assistant: (text: string) => text,
	tool: (text: string) => `\x1b[90m${text}\x1b[0m`,
	error: (text: string) => `\x1b[31m${text}\x1b[0m`,
	status: (text: string) => `\x1b[90m${text}\x1b[0m`,
	confirmation: (text: string) => `\x1b[33m${text}\x1b[0m`,
	title: (text: string) => `\x1b[1m\x1b[33m${text}\x1b[0m`,
} as const;

/** Assistant message that can be updated in place as deltas arrive. */
class AssistantMessageComponent {
	private readonly text: Text;

	constructor(
		private readonly container: Container,
		content: string,
	) {
		this.text = new Text(content, 1, 0);
		this.container.addChild(this.text);
	}

	setContent(content: string): void {
		this.text.setText(content);
	}
}

export class ChatView {
	/** Container added to the TUI; messages are appended to it. */
	readonly container = new Container();
	private assistant: AssistantMessageComponent | undefined;

	addUserMessage(content: string): void {
		this.assistant = undefined;
		this.container.addChild(new Text(STYLES.user(`You: ${content}`), 1, 0));
	}

	updateAssistant(content: string): void {
		if (this.assistant === undefined) {
			this.assistant = new AssistantMessageComponent(this.container, content);
			return;
		}
		this.assistant.setContent(content);
	}

	finishAssistant(): void {
		this.assistant = undefined;
	}

	startTool(toolCallId: string, toolName: string): void {
		this.container.addChild(new Text(STYLES.tool(`[tool] ${toolName}`), 1, 0));
		void toolCallId;
	}

	completeTool(toolName: string, isError?: boolean): void {
		const mark = isError ? "failed" : "ok";
		this.container.addChild(new Text(STYLES.tool(`[tool] ${toolName} ${mark}`), 1, 0));
	}

	addError(code: string, message: string): void {
		this.container.addChild(new Text(STYLES.error(`Error [${code}]: ${message}`), 1, 0));
	}

	addInfo(text: string): void {
		this.container.addChild(new Text(text, 1, 0));
	}

	renderEvent(event: UavAgentEvent): void {
		switch (event.type) {
			case "message.delta":
				this.updateAssistant(event.content);
				break;
			case "message.completed":
				this.updateAssistant(event.content);
				this.finishAssistant();
				break;
			case "tool.started":
				this.startTool(event.toolCallId, event.toolName);
				break;
			case "tool.completed":
				this.completeTool(event.toolName, event.isError);
				break;
			case "error":
				this.addError(event.code, event.message);
				break;
			case "turn.started":
			case "turn.completed":
				break;
			case "action.confirmation_required":
				this.container.addChild(
					new Text(
						STYLES.confirmation(
							`[确认] ${event.actionType}: ${event.summary} — /confirm ${event.actionId.slice(0, 8)} 或 /cancel ${event.actionId.slice(0, 8)}`,
						),
						1,
						0,
					),
				);
				break;
			case "action.started":
			case "action.completed":
				break;
		}
	}
}
