/**
 * Assistant message block.
 *
 * One instance per assistant message: a single "◆ UAV Agent" identity header
 * followed by markdown-rendered body text that updates in place as streaming
 * deltas arrive. ChatView guarantees one instance per message, so the header
 * never repeats per delta.
 */
import { Container, Markdown, type MarkdownTheme, Text } from "@earendil-works/pi-tui";
import { STYLES } from "./styles.ts";

const HEADER = "◆ UAV Agent";

/** Markdown theme matching the fixed UAV terminal scheme. */
export const UAV_MARKDOWN_THEME: MarkdownTheme = {
	heading: (text: string) => `${STYLES.agentHeader(text)}`,
	link: (text: string) => `\x1b[36m\x1b[4m${text}\x1b[0m`,
	linkUrl: (text: string) => STYLES.status(text),
	code: (text: string) => `\x1b[33m${text}\x1b[0m`,
	codeBlock: (text: string) => text,
	codeBlockBorder: (text: string) => STYLES.status(text),
	quote: (text: string) => STYLES.status(text),
	quoteBorder: (text: string) => STYLES.status(text),
	hr: (text: string) => STYLES.status(text),
	listBullet: (text: string) => STYLES.agentHeader(text),
	bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
	italic: (text: string) => `\x1b[3m${text}\x1b[0m`,
	strikethrough: (text: string) => `\x1b[9m${text}\x1b[0m`,
	underline: (text: string) => `\x1b[4m${text}\x1b[0m`,
};

export class AssistantMessageComponent extends Container {
	private readonly body: Markdown;

	constructor(content: string) {
		super();
		this.addChild(new Text(STYLES.agentHeader(HEADER), 0, 0));
		// paddingY 0: spacing between blocks is handled by the chat container.
		this.body = new Markdown(content, 1, 0, UAV_MARKDOWN_THEME);
		this.addChild(this.body);
	}

	/** Replace the body text (streaming delta or final content). */
	setContent(content: string): void {
		this.body.setText(content);
	}
}
