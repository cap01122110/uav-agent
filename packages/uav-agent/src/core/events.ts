/**
 * UAV agent event protocol.
 *
 * This is the stable event contract between UI adapters (TUI today, web/HTTP
 * later) and the UavAgentRuntime. Pi-internal event types never cross this
 * boundary; the Pi event adapter maps them into these events.
 *
 * The protocol is intentionally minimal. Adapters render only these events and
 * never depend on pi agent internals.
 */

/** A text update for the current assistant message. */
export interface MessageDeltaEvent {
	type: "message.delta";
	content: string;
}

/** The assistant finished one complete message. */
export interface MessageCompletedEvent {
	type: "message.completed";
	content: string;
}

/** A tool call started executing. */
export interface ToolStartedEvent {
	type: "tool.started";
	toolCallId: string;
	toolName: string;
	input?: unknown;
}

/** A tool call finished executing. */
export interface ToolCompletedEvent {
	type: "tool.completed";
	toolCallId: string;
	toolName: string;
	result?: unknown;
	isError?: boolean;
}

/** A high-risk action needs explicit user confirmation before it can proceed. */
export interface ActionConfirmationRequiredEvent {
	type: "action.confirmation_required";
	actionId: string;
	actionType: string;
	summary: string;
}

/** An action started executing. */
export interface ActionStartedEvent {
	type: "action.started";
	actionId: string;
}

/** An action finished executing. */
export interface ActionCompletedEvent {
	type: "action.completed";
	actionId: string;
	result?: unknown;
}

/** A runtime error occurred. Codes are stable, non-transport-specific. */
export interface UavErrorEvent {
	type: "error";
	code: string;
	message: string;
}

/** An agent turn started. */
export interface TurnStartedEvent {
	type: "turn.started";
}

/** An agent turn finished. */
export interface TurnCompletedEvent {
	type: "turn.completed";
}

export type UavAgentEvent =
	| MessageDeltaEvent
	| MessageCompletedEvent
	| ToolStartedEvent
	| ToolCompletedEvent
	| ActionConfirmationRequiredEvent
	| ActionStartedEvent
	| ActionCompletedEvent
	| UavErrorEvent
	| TurnStartedEvent
	| TurnCompletedEvent;

export type UavAgentEventListener = (event: UavAgentEvent) => void;
