/**
 * Tool activity line.
 *
 * One component per tool call, keyed by toolCallId by the ChatView. It starts
 * as a running marker and is updated in place on completion:
 *
 *   ↳ resolve_airport   (running, dim)
 *   ✓ resolve_airport   (success, dim)
 *   ✗ resolve_airport   (failure, red)
 *
 * In-place update works because pi-tui renders components lazily per frame;
 * mutating this component's state before the next render is enough.
 */
import { Text } from "@earendil-works/pi-tui";
import { STYLES } from "./styles.ts";

export type ToolActivityStatus = "running" | "success" | "failure";

const MARKS: Record<ToolActivityStatus, string> = {
	running: "↳",
	success: "✓",
	failure: "✗",
};

function styleFor(status: ToolActivityStatus): (text: string) => string {
	return status === "failure" ? STYLES.error : STYLES.tool;
}

export class ToolActivityComponent extends Text {
	private status: ToolActivityStatus = "running";
	private toolName: string;

	constructor(toolCallId: string, toolName: string) {
		super("", 0, 0);
		void toolCallId;
		this.toolName = toolName;
		this.applyText();
	}

	/** Record the tool result; unknown tools complete as success. */
	complete(isError: boolean): void {
		this.status = isError ? "failure" : "success";
		this.applyText();
	}

	getStatus(): ToolActivityStatus {
		return this.status;
	}

	private applyText(): void {
		this.setText(styleFor(this.status)(`${MARKS[this.status]} ${this.toolName}`));
	}
}
