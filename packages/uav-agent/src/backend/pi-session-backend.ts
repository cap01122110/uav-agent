/**
 * Pi session backend.
 *
 * Wraps one coding-agent AgentSession (the "Pi Runtime" layer) behind the UAV
 * session backend abstraction. Pi event types are translated to UAV events
 * here; nothing pi-specific crosses the UAV runtime boundary.
 */

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { mapPiEvent } from "../core/event-mapper.ts";
import type { UavAgentEvent, UavAgentEventListener } from "../core/events.ts";
import type { UavSessionBackend } from "../core/session-registry.ts";

export class PiSessionBackend implements UavSessionBackend {
	readonly sessionId: string;
	private readonly session: AgentSession;
	private readonly listeners = new Set<UavAgentEventListener>();
	private readonly unsubscribeSession: () => void;
	private closed = false;

	constructor(sessionId: string, session: AgentSession) {
		this.sessionId = sessionId;
		this.session = session;
		this.unsubscribeSession = session.subscribe((event: AgentSessionEvent) => {
			for (const uavEvent of mapPiEvent(event)) {
				this.emit(uavEvent);
			}
		});
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
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	async close(): Promise<void> {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.unsubscribeSession();
		await this.session.dispose();
	}
}
