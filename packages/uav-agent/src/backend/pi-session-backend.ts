/**
 * Pi session backend.
 *
 * Wraps one coding-agent AgentSession (the "Pi Runtime" layer) behind the UAV
 * session backend abstraction. Pi event types are translated to UAV events
 * here; nothing pi-specific crosses the UAV runtime boundary.
 */

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { UavAgentEvent, UavAgentEventListener } from "../core/events.ts";
import type { SessionContext, UavSessionBackend } from "../core/session-registry.ts";
import { PiEventAdapter } from "./pi-event-adapter.ts";

export class PiSessionBackend implements UavSessionBackend {
	readonly sessionId: string;
	private readonly session: AgentSession;
	private readonly context: SessionContext;
	private readonly listeners = new Set<UavAgentEventListener>();
	private readonly adapter = new PiEventAdapter();
	private readonly unsubscribeSession: () => void;
	private closed = false;

	constructor(sessionId: string, session: AgentSession, context: SessionContext) {
		this.sessionId = sessionId;
		this.session = session;
		this.context = context;
		this.unsubscribeSession = session.subscribe((event: AgentSessionEvent) => {
			for (const uavEvent of this.adapter.map(event)) {
				this.emit(uavEvent);
			}
		});
	}

	getContext(): SessionContext {
		return this.context;
	}

	async sendMessage(message: string): Promise<void> {
		if (this.closed) {
			throw new Error("Session is closed");
		}
		await this.session.prompt(message, { expandPromptTemplates: false });
	}

	subscribe(listener: UavAgentEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: UavAgentEvent): void {
		// Isolate subscriber failures: one broken listener (e.g. a UI component)
		// must not block other listeners or pi session persistence.
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch {
				// A subscriber throwing must not break the event fan-out.
			}
		}
	}

	async close(): Promise<void> {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.listeners.clear();
		this.unsubscribeSession();
		await this.session.dispose();
	}
}
