/**
 * TUI adapter.
 *
 * A lightweight terminal UI on top of UavAgentRuntime. It only:
 * - reads user input and calls runtime.sendMessage()
 * - renders runtime events
 * - shows confirmations and calls runtime.confirmAction()/cancelAction()
 *
 * It contains no UAV business logic. Swapping this adapter for a web/HTTP
 * adapter must not require runtime changes.
 */

import { Input, ProcessTerminal, Text, TuiMainScreen } from "@earendil-works/pi-tui";
import type { UavAgentEvent } from "../../core/events.ts";
import type { UavAgentRuntime } from "../../core/runtime.ts";
import { ChatView, STYLES } from "./chat-view.ts";

export interface TuiAdapterOptions {
	runtime: UavAgentRuntime;
	sessionId: string;
	/** Header title. Defaults to "UAV Agent". */
	title?: string;
}

export class TuiAdapter {
	private readonly runtime: UavAgentRuntime;
	private readonly sessionId: string;
	private readonly title: string;
	private chat: ChatView | undefined;
	private status: Text | undefined;
	private input: Input | undefined;
	private tui: TuiMainScreen | undefined;
	private unsubscribe: (() => void) | undefined;
	private busy = false;
	private resolveExit: (() => void) | undefined;

	constructor(options: TuiAdapterOptions) {
		this.runtime = options.runtime;
		this.sessionId = options.sessionId;
		this.title = options.title ?? "UAV Agent";
	}

	async run(): Promise<void> {
		const tui = new TuiMainScreen(new ProcessTerminal(), false);
		this.tui = tui;
		const chat = new ChatView();
		this.chat = chat;
		const status = new Text(STYLES.status(`Session: ${this.sessionId}`), 1, 0);
		this.status = status;
		const input = new Input();
		this.input = input;

		input.onSubmit = (value) => {
			this.submit(value);
		};
		input.onEscape = () => {
			// Escape cancels the current input line.
			input.setValue("");
		};

		tui.addChild(new Text(STYLES.title(this.title), 1, 0));
		tui.addChild(chat.container);
		tui.addChild(status);
		tui.addChild(input);
		tui.setFocus(input);
		tui.start();

		// Intercept Ctrl+C to quit.
		const unsubscribeInput = tui.addInputListener((data) => {
			if (data === "\u0003") {
				this.quit();
				return { consume: true };
			}
			return undefined;
		});
		const unsubscribeRuntime = this.runtime.subscribe(this.sessionId, (event) => {
			this.handleEvent(event);
		});
		this.unsubscribe = () => {
			unsubscribeInput();
			unsubscribeRuntime();
		};

		await new Promise<void>((resolve) => {
			this.resolveExit = resolve;
		});

		this.unsubscribe();
		tui.stop();
	}

	private submit(value: string): void {
		if (this.busy) {
			this.chat?.addInfo(STYLES.status("Agent is busy, please wait."));
			return;
		}
		this.input?.setValue("");
		if (value.startsWith("/")) {
			this.handleCommand(value);
			return;
		}
		this.chat?.addUserMessage(value);
		this.setStatus("working...");
		this.busy = true;
		void this.runtime.sendMessage(this.sessionId, value);
	}

	private handleCommand(commandLine: string): void {
		const [command, ...args] = commandLine.split(/\s+/);
		const arg = args.join(" ");
		switch (command) {
			case "/quit":
			case "/exit":
				this.quit();
				break;
			case "/actions": {
				const actions = this.runtime.listActions(this.sessionId);
				if (actions.length === 0) {
					this.chat?.addInfo(STYLES.status("No actions."));
				} else {
					for (const action of actions) {
						this.chat?.addInfo(
							STYLES.status(
								`[action] ${action.id.slice(0, 8)} ${action.type} (${action.status}) ${action.summary}`,
							),
						);
					}
				}
				break;
			}
			case "/confirm": {
				if (arg.length === 0) {
					this.chat?.addInfo(STYLES.status("Usage: /confirm <actionId>"));
					break;
				}
				void this.runtime
					.confirmAction(this.sessionId, arg)
					.then((result) => {
						this.chat?.addInfo(STYLES.confirmation(`Action ${result.actionId.slice(0, 8)} confirmed.`));
					})
					.catch((error: unknown) => {
						this.chat?.addError("CONFIRM_FAILED", error instanceof Error ? error.message : String(error));
					});
				break;
			}
			case "/cancel": {
				if (arg.length === 0) {
					this.chat?.addInfo(STYLES.status("Usage: /cancel <actionId>"));
					break;
				}
				void this.runtime
					.cancelAction(this.sessionId, arg)
					.then(() => {
						this.chat?.addInfo(STYLES.confirmation(`Action ${arg.slice(0, 8)} cancelled.`));
					})
					.catch((error: unknown) => {
						this.chat?.addError("CANCEL_FAILED", error instanceof Error ? error.message : String(error));
					});
				break;
			}
			default:
				this.chat?.addInfo(STYLES.status(`Unknown command: ${command}. Try /actions, /confirm, /cancel, /quit.`));
				break;
		}
	}

	private handleEvent(event: UavAgentEvent): void {
		switch (event.type) {
			case "turn.started":
				this.setStatus("working...");
				break;
			case "turn.completed":
				this.setStatus(`Session: ${this.sessionId}`);
				this.busy = false;
				break;
			case "error":
				this.busy = false;
				this.setStatus(`Session: ${this.sessionId}`);
				break;
			case "action.confirmation_required":
				this.setStatus(
					STYLES.confirmation(
						`Confirmation required [${event.actionType}]: ${event.summary} — /confirm ${event.actionId.slice(0, 8)} or /cancel ${event.actionId.slice(0, 8)}`,
					),
				);
				break;
			default:
				break;
		}
		this.chat?.renderEvent(event);
		this.tui?.requestRender();
	}

	private setStatus(text: string): void {
		this.status?.setText(text);
	}

	private quit(): void {
		this.resolveExit?.();
	}
}
