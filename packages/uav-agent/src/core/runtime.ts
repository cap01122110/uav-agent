/**
 * UavAgentRuntime - the UAV product layer's agent runtime.
 *
 * UI adapters depend only on this interface and the UAV event protocol. The
 * runtime owns session lifecycle (via SessionRegistry), message dispatch, event
 * fan-out, and action confirmation. Pi internals never leak past this boundary.
 */

import { ActionService, type PrepareActionInput } from "../actions/action-service.ts";
import type { ActionStore } from "../actions/action-store.ts";
import { InMemoryActionStore } from "../actions/action-store.ts";
import type { ActionResult, UavAction } from "../actions/types.ts";
import type { UavAgentEvent, UavAgentEventListener } from "./events.ts";
import type { CreateSessionOptions, UavSessionBackend, UavSessionFactory } from "./session-registry.ts";
import { SessionRegistry } from "./session-registry.ts";

export interface UavAgentRuntime {
	/** Create a session and return its id. Throws if the id already runs. */
	createSession(options?: CreateSessionOptions): Promise<string>;
	/** Resume a session: reuse the running backend or restore persisted history. */
	resumeSession(options?: CreateSessionOptions): Promise<string>;
	/** Create or resume a session id. Alias of resumeSession. */
	createOrResumeSession(options?: CreateSessionOptions): Promise<string>;
	/** Send a user message to a session; triggers an agent turn. */
	sendMessage(sessionId: string, message: string): Promise<void>;
	/** Subscribe to UAV events for one session. Returns an unsubscribe function. */
	subscribe(sessionId: string, listener: UavAgentEventListener): () => void;
	/** Confirm a pending high-risk action. */
	confirmAction(sessionId: string, actionId: string): Promise<ActionResult>;
	/** Cancel a pending action. */
	cancelAction(sessionId: string, actionId: string): Promise<void>;
	/** List actions belonging to one session. */
	listActions(sessionId: string): UavAction[];
	/** Prepare a high-risk action; moves it to WAITING_CONFIRMATION. */
	prepareAction(sessionId: string, input: PrepareActionInput): Promise<UavAction>;
	/** Close one session. */
	closeSession(sessionId: string): Promise<void>;
	/** Close all sessions and release runtime resources. */
	close(): Promise<void>;
}

export interface UavAgentRuntimeOptions {
	/** Creates pi-backed session backends. */
	factory: UavSessionFactory;
	/** Action store used for confirmation flows. Defaults to an in-memory store. */
	actions?: ActionStore;
}

export class UavAgentRuntimeImpl implements UavAgentRuntime {
	private readonly registry: SessionRegistry;
	private readonly actions: ActionService;

	constructor(options: UavAgentRuntimeOptions) {
		this.registry = new SessionRegistry(options.factory);
		const store = options.actions ?? new InMemoryActionStore();
		this.actions = new ActionService(store, {
			onActionEvent: (sessionId, event) => this.emitToSession(sessionId, event),
		});
	}

	async createSession(options: CreateSessionOptions = {}): Promise<string> {
		return this.registry.create(options);
	}

	async resumeSession(options: CreateSessionOptions = {}): Promise<string> {
		return this.registry.resume(options);
	}

	async createOrResumeSession(options: CreateSessionOptions = {}): Promise<string> {
		return this.registry.resume(options);
	}

	async sendMessage(sessionId: string, message: string): Promise<void> {
		const backend = this.requireSession(sessionId);
		try {
			await backend.sendMessage(message);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			backend.emit({ type: "error", code: "INTERNAL_ERROR", message: detail });
		}
	}

	subscribe(sessionId: string, listener: UavAgentEventListener): () => void {
		return this.requireSession(sessionId).subscribe(listener);
	}

	async confirmAction(sessionId: string, actionId: string): Promise<ActionResult> {
		this.requireSession(sessionId);
		const action = this.actions.resolve(sessionId, actionId);
		return this.actions.confirm(sessionId, action.id);
	}

	async cancelAction(sessionId: string, actionId: string): Promise<void> {
		this.requireSession(sessionId);
		const action = this.actions.resolve(sessionId, actionId);
		await this.actions.cancel(sessionId, action.id);
	}

	async prepareAction(sessionId: string, input: PrepareActionInput): Promise<UavAction> {
		this.requireSession(sessionId);
		return this.actions.prepare(sessionId, input);
	}

	listActions(sessionId: string): UavAction[] {
		this.requireSession(sessionId);
		return this.actions.list(sessionId);
	}

	private emitToSession(sessionId: string, event: UavAgentEvent): void {
		if (!this.registry.has(sessionId)) return;
		this.registry.get(sessionId).emit(event);
	}

	async closeSession(sessionId: string): Promise<void> {
		await this.registry.remove(sessionId);
	}

	async close(): Promise<void> {
		await this.registry.closeAll();
	}

	private requireSession(sessionId: string): UavSessionBackend {
		return this.registry.get(sessionId);
	}
}
