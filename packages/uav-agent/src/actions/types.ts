/**
 * Action domain types.
 *
 * An action is a deterministic, runtime-controlled operation (e.g. a flight
 * control command) that may require explicit user confirmation. Action state
 * lives in an ActionStore, never only in the LLM conversation.
 */

export type ActionStatus =
	| "PREPARED"
	| "WAITING_CONFIRMATION"
	| "CONFIRMED"
	| "EXECUTING"
	| "SUCCEEDED"
	| "FAILED"
	| "CANCELLED"
	| "EXPIRED";

export interface UavAction {
	/** Stable action id used for confirmation and cancellation. */
	id: string;
	/** Session the action belongs to. */
	sessionId: string;
	/** Business action type, e.g. "return_home". */
	type: string;
	/** Human-readable summary shown to the user for confirmation. */
	summary: string;
	/** Structured payload for the executor. */
	payload?: unknown;
	status: ActionStatus;
	createdAt: number;
	updatedAt: number;
	result?: unknown;
	error?: string;
}

export interface ActionResult {
	actionId: string;
	status: ActionStatus;
}

/** Error thrown for invalid action state transitions. */
export class ActionError extends Error {
	readonly code: "ACTION_NOT_FOUND" | "INVALID_TRANSITION";

	constructor(code: ActionError["code"], message: string) {
		super(message);
		this.name = "ActionError";
		this.code = code;
	}
}
