/**
 * One-off notice blocks: errors, confirmations, separators.
 *
 * Error and confirmation content comes straight from runtime events; this
 * module adds visual weight only.
 */
import { Container, Text } from "@earendil-works/pi-tui";
import { STYLES } from "./styles.ts";

/** Horizontal rule shown between conversation turns. */
export function separatorLine(width: number): Text {
	return new Text(STYLES.separator("─".repeat(Math.max(8, width))), 0, 0);
}

/** Red standalone error block: header line with code, message below. */
export class ErrorComponent extends Container {
	constructor(code: string, message: string) {
		super();
		this.addChild(new Text(STYLES.error(`✗ Error [${code}]`), 0, 0));
		for (const line of message.split("\n")) {
			this.addChild(new Text(STYLES.error(`  ${line}`), 0, 0));
		}
	}
}

/** Yellow confirmation block with the command hints the user can run. */
export class ConfirmationComponent extends Container {
	constructor(actionType: string, summary: string, actionId: string) {
		super();
		const shortId = actionId.slice(0, 8);
		this.addChild(new Text(STYLES.confirmation("⚠ 需要确认"), 0, 0));
		this.addChild(new Text(STYLES.confirmation(`${actionType}: ${summary}`), 1, 0));
		this.addChild(new Text(STYLES.confirmation(`/confirm ${shortId}`), 1, 0));
		this.addChild(new Text(STYLES.confirmation(`/cancel ${shortId}`), 1, 0));
	}
}
