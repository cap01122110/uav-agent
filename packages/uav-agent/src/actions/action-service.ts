/**
 * ActionService - confirmation-gated action lifecycle.
 *
 * High-risk physical operations must never be executed directly by the model.
 * The flow is: prepare (tool) -> WAITING_CONFIRMATION -> user confirms via
 * runtime.confirmAction() -> CONFIRMED -> (future executor) -> executed.
 *
 * Phase 9 ships the confirmation skeleton only; no real flight action is
 * executed. Action state lives in the ActionStore, never only in the LLM
 * conversation.
 */

import type { UavAgentEvent } from "../core/events.ts";
import type { ActionStore } from "./action-store.ts";
import { ActionError, type ActionResult, type ActionStatus, type UavAction } from "./types.ts";

export interface PrepareActionInput {
	/** Business action type, e.g. "return_home". */
	type: string;
	/** Human-readable summary shown to the user for confirmation. */
	summary: string;
	/** Structured payload for the future executor. */
	payload?: unknown;
}

/** Optional deterministic executor invoked after confirmation. */
export interface ActionExecutor {
	execute(action: UavAction): Promise<unknown>;
}

export interface ActionServiceOptions {
	/** Emitted for every action lifecycle event (confirmation, started, completed). */
	onActionEvent?: (sessionId: string, event: UavAgentEvent) => void;
	/** Optional executor run after confirmation. Not configured in Phase 9. */
	executor?: ActionExecutor;
}

export class ActionService {
	private readonly store: ActionStore;
	private readonly executor: ActionExecutor | undefined;
	private readonly onActionEvent: ((sessionId: string, event: UavAgentEvent) => void) | undefined;

	constructor(store: ActionStore, options: ActionServiceOptions = {}) {
		this.store = store;
		this.executor = options.executor;
		this.onActionEvent = options.onActionEvent;
	}

	/**
	 * Create a pending action and move it to WAITING_CONFIRMATION.
	 * Emits action.confirmation_required so the UI can prompt the user.
	 */
	prepare(sessionId: string, input: PrepareActionInput): UavAction {
		const action = this.store.create({
			sessionId,
			type: input.type,
			summary: input.summary,
			payload: input.payload,
		});
		this.store.transition(action.id, "WAITING_CONFIRMATION");
		this.emit(sessionId, {
			type: "action.confirmation_required",
			actionId: action.id,
			actionType: action.type,
			summary: action.summary,
		});
		return action;
	}

	/**
	 * Confirm a pending action. Without an executor the action stays CONFIRMED.
	 * With an executor, returns the final status: SUCCEEDED on success, or
	 * throws an ActionError carrying the failure.
	 */
	async confirm(sessionId: string, actionId: string): Promise<ActionResult> {
		const action = this.requireOwned(sessionId, actionId);
		const result = this.store.confirm(action.id);
		if (this.executor === undefined) {
			return result;
		}
		return this.executeConfirmed(action.id);
	}

	async cancel(sessionId: string, actionId: string): Promise<ActionResult> {
		const action = this.requireOwned(sessionId, actionId);
		return this.store.cancel(action.id);
	}

	/**
	 * Resolve an action by full id or by a unique session-scoped prefix.
	 * Prefixes with zero or multiple matches are rejected.
	 */
	resolve(sessionId: string, idOrPrefix: string): UavAction {
		const exact = this.store.get(idOrPrefix);
		if (exact !== undefined && exact.sessionId === sessionId) {
			return exact;
		}
		const matches = this.store
			.list()
			.filter((action) => action.sessionId === sessionId && action.id.startsWith(idOrPrefix));
		if (matches.length === 1) {
			return matches[0]!;
		}
		throw new ActionError(
			matches.length === 0 ? "ACTION_NOT_FOUND" : "AMBIGUOUS_ACTION_ID",
			matches.length === 0
				? `Action not found: ${idOrPrefix}`
				: `Ambiguous action id prefix: ${idOrPrefix} (${matches.length} matches)`,
		);
	}

	get(sessionId: string, actionId: string): UavAction | undefined {
		const action = this.store.get(actionId);
		if (action === undefined || action.sessionId !== sessionId) return undefined;
		return action;
	}

	list(sessionId: string): UavAction[] {
		return this.store.list().filter((action) => action.sessionId === sessionId);
	}

	private async executeConfirmed(actionId: string): Promise<ActionResult> {
		const action = this.store.get(actionId);
		if (action === undefined) {
			throw new ActionError("ACTION_NOT_FOUND", `Action not found: ${actionId}`);
		}
		this.store.transition(actionId, "EXECUTING");
		this.emit(action.sessionId, { type: "action.started", actionId });
		try {
			const result = await this.executor?.execute(action);
			this.store.transition(actionId, "SUCCEEDED");
			action.result = result;
			this.emit(action.sessionId, { type: "action.completed", actionId, result });
			return { actionId, status: "SUCCEEDED" };
		} catch (error) {
			this.store.transition(actionId, "FAILED");
			const message = error instanceof Error ? error.message : String(error);
			action.error = message;
			this.emit(action.sessionId, {
				type: "action.completed",
				actionId,
				result: { error: message },
			});
			throw new ActionError("EXECUTION_FAILED", `Action execution failed: ${message}`, { actionId });
		}
	}

	private requireOwned(sessionId: string, actionId: string): UavAction {
		const action = this.store.get(actionId);
		if (action === undefined || action.sessionId !== sessionId) {
			throw new ActionError("ACTION_NOT_FOUND", `Action not found: ${actionId}`);
		}
		return action;
	}

	private emit(sessionId: string, event: UavAgentEvent): void {
		this.onActionEvent?.(sessionId, event);
	}
}

export type { ActionStatus };
