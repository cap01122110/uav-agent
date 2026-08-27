/**
 * User message block.
 *
 * Rendered as a light three-line frame instead of a "You:" prefix so the user
 * input reads as its own visual region:
 *
 *   ┌─ 你
 *   │ 查询 Test-01 当前状态
 *   └
 *
 * Multi-line input renders one │ line per source line. The frame is dim cyan;
 * content is cyan.
 */
import { Container, Text, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { STYLES } from "./styles.ts";

/** Width available to user content when the terminal width is unknown (tests, early render). */
const DEFAULT_WIDTH = 80;
/** Left padding inside the │ border. */
const CONTENT_PAD = 1;

export class UserMessageComponent extends Container {
	constructor(content: string, width: number = DEFAULT_WIDTH) {
		super();
		this.addChild(new Text(STYLES.userBorder("┌─ 你"), 0, 0));
		const contentWidth = Math.max(1, width - 2 - CONTENT_PAD);
		for (const sourceLine of content.split("\n")) {
			for (const wrapped of wrapTextWithAnsi(sourceLine, contentWidth)) {
				this.addChild(new Text(STYLES.user(`│ ${" ".repeat(CONTENT_PAD)}${wrapped}`), 0, 0));
			}
		}
		this.addChild(new Text(STYLES.userBorder("└"), 0, 0));
	}
}
