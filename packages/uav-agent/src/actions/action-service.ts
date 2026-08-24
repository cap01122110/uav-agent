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

/** Optional deterministic executor invoked after confirmation (Phase 9: none). */
export interface ActionExecutor {
	execute(action: UavAction): Promise<unknown>;
}

export interface ActionServiceOptions {
	/** Emitted when an action requires user confirmation. */
	onConfirmationRequired?: (sessionId: string, event: UavAgentEvent) => void;
	/** Optional executor run after confirmation. Not configured in Phase 9. */
	executor?: ActionExecutor;
}

export class ActionService {
	private readonly store: ActionStore;
	private readonly executor: ActionExecutor | undefined;
	private readonly onConfirmationRequired: ((sessionId: string, event: UavAgentEvent) => void) | undefined;

	constructor(store: ActionStore, options: ActionServiceOptions = {}) {
		this.store = store;
		this.executor = options.executor;
		this.onConfirmationRequired = options.onConfirmationRequired;
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
		this.onConfirmationRequired?.(sessionId, {
			type: "action.confirmation_required",
			actionId: action.id,
			actionType: action.type,
			summary: action.summary,
		});
		return action;
	}

	/** Confirm a pending action. With no executor configured it stays CONFIRMED. */
	async confirm(sessionId: string, actionId: string): Promise<ActionResult> {
		this.assertOwned(sessionId, actionId);
		const result = this.store.confirm(actionId);
		if (this.executor !== undefined) {
			await this.executeConfirmed(actionId);
		}
		return result;
	}

	async cancel(sessionId: string, actionId: string): Promise<ActionResult> {
		this.assertOwned(sessionId, actionId);
		return this.store.cancel(actionId);
	}

	get(sessionId: string, actionId: string): UavAction | undefined {
		const action = this.store.get(actionId);
		if (action === undefined || action.sessionId !== sessionId) return undefined;
		return action;
	}

	list(sessionId: string): UavAction[] {
		return this.store.list().filter((action) => action.sessionId === sessionId);
	}

	private async executeConfirmed(actionId: string): Promise<void> {
		const action = this.store.get(actionId);
		if (action === undefined) return;
		this.store.transition(actionId, "EXECUTING");
		try {
			const result = await this.executor?.execute(action);
			this.store.transition(actionId, "SUCCEEDED");
			action.result = result;
		} catch (error) {
			this.store.transition(actionId, "FAILED");
			action.error = error instanceof Error ? error.message : String(error);
		}
	}

	private assertOwned(sessionId: string, actionId: string): void {
		const action = this.store.get(actionId);
		if (action === undefined) {
			throw new ActionError("ACTION_NOT_FOUND", `Action not found: ${actionId}`);
		}
		if (action.sessionId !== sessionId) {
			throw new ActionError("ACTION_NOT_FOUND", `Action not found: ${actionId}`);
		}
	}
}

export type { ActionStatus };
