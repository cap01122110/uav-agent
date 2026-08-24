/**
 * In-memory action store with a validated state machine.
 *
 * This is the Phase 3 skeleton: state transitions are enforced, but no action
 * executor exists yet. Phase 9 replaces the store interface with a durable
 * ActionService (DB/Redis) and adds real execution.
 */

import { randomUUID } from "node:crypto";
import { ActionError, type ActionResult, type ActionStatus, type UavAction } from "./types.ts";

/** Legal state transitions. Anything not listed here is rejected. */
const ALLOWED_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
	PREPARED: ["WAITING_CONFIRMATION", "CANCELLED", "EXPIRED"],
	WAITING_CONFIRMATION: ["CONFIRMED", "CANCELLED", "EXPIRED"],
	CONFIRMED: ["EXECUTING", "CANCELLED"],
	EXECUTING: ["SUCCEEDED", "FAILED", "CANCELLED"],
	SUCCEEDED: [],
	FAILED: [],
	CANCELLED: [],
	EXPIRED: [],
};

export interface ActionStore {
	create(input: Omit<UavAction, "id" | "status" | "createdAt" | "updatedAt">): UavAction;
	get(actionId: string): UavAction | undefined;
	list(): UavAction[];
	/** Move an action to a new status, validating the transition. */
	transition(actionId: string, status: ActionStatus): ActionResult;
	/** PREPARED/WAITING_CONFIRMATION -> CONFIRMED. */
	confirm(actionId: string): ActionResult;
	/** PREPARED/WAITING_CONFIRMATION/CONFIRMED -> CANCELLED. */
	cancel(actionId: string): ActionResult;
	/** WAITING_CONFIRMATION -> EXPIRED. */
	expire(actionId: string): ActionResult;
}

export class InMemoryActionStore implements ActionStore {
	private readonly actions = new Map<string, UavAction>();

	create(input: Omit<UavAction, "id" | "status" | "createdAt" | "updatedAt">): UavAction {
		const now = Date.now();
		const action: UavAction = {
			...input,
			id: randomUUID(),
			status: "PREPARED",
			createdAt: now,
			updatedAt: now,
		};
		this.actions.set(action.id, action);
		return action;
	}

	get(actionId: string): UavAction | undefined {
		return this.actions.get(actionId);
	}

	list(): UavAction[] {
		return Array.from(this.actions.values());
	}

	transition(actionId: string, status: ActionStatus): ActionResult {
		const action = this.actions.get(actionId);
		if (action === undefined) {
			throw new ActionError("ACTION_NOT_FOUND", `Action not found: ${actionId}`);
		}
		const allowed = ALLOWED_TRANSITIONS[action.status];
		if (!allowed.includes(status)) {
			throw new ActionError(
				"INVALID_TRANSITION",
				`Cannot transition action ${actionId} from ${action.status} to ${status}`,
			);
		}
		action.status = status;
		action.updatedAt = Date.now();
		return { actionId, status };
	}

	confirm(actionId: string): ActionResult {
		return this.transition(actionId, "CONFIRMED");
	}

	cancel(actionId: string): ActionResult {
		return this.transition(actionId, "CANCELLED");
	}

	expire(actionId: string): ActionResult {
		return this.transition(actionId, "EXPIRED");
	}
}
