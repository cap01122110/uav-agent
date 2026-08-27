/**
 * Shared ANSI styling for the UAV chat TUI.
 *
 * Plain escape codes (no theme system): the UAV TUI is a fixed, professional
 * light-on-dark scheme — cyan identity, dim tool activity, red errors, yellow
 * confirmations.
 */

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GRAY = "\x1b[90m";
const RESET = "\x1b[0m";

function styled(...codes: string[]): (text: string) => string {
	return (text: string) => `${codes.join("")}${text}${RESET}`;
}

export const STYLES = {
	/** User message border lines (┌─ 你 / │ / └). */
	userBorder: styled(DIM, CYAN),
	/** User message content. */
	user: styled(CYAN),
	/** Agent identity header (◆ UAV Agent). */
	agentHeader: styled(BOLD, CYAN),
	/** Tool activity: running and success states stay dim (background noise). */
	tool: styled(GRAY),
	/** Failures and errors. */
	error: styled(RED),
	/** Footers, hints, separators. */
	status: styled(GRAY),
	/** Turn separator rule. */
	separator: styled(GRAY),
	/** Confirmation prompts. */
	confirmation: styled(YELLOW),
	/** TUI frame title. */
	title: styled(BOLD, YELLOW),
} as const;
