/**
 * Session registry.
 *
 * Maps stable UAV session ids to running session backends. A session is not
 * bound to a process or a UI instance: the registry supports any number of
 * concurrent sessions, each backed by its own pi session underneath.
 *
 * Duplicate ids are rejected on create; resuming an existing id returns the
 * running backend instead of overwriting it.
 */
import { randomUUID } from "node:crypto";
import type { AgentChannel, AgentContext } from "./context.ts";
import type { UavAgentEvent, UavAgentEventListener } from "./events.ts";

export interface CreateSessionOptions {
	/** Explicit session id. Defaults to a generated id. */
	sessionId?: string;
	userId?: string;
	tenantId?: string;
	channel?: AgentChannel;
}

/** Session identity and channel context, materialized for the backend. */
export type SessionContext = AgentContext;

/**
 * A running session backend.
 *
 * Implementations wrap a pi session (or a test fake) and translate pi events
 * into UAV events before forwarding them to subscribers.
 */
export interface UavSessionBackend {
	readonly sessionId: string;
	/** Materialized identity/channel context for this session. */
	getContext(): SessionContext;
	/** Send a user message; triggers an agent turn. */
	sendMessage(message: string): Promise<void>;
	/** Subscribe to UAV events emitted by this session. Returns an unsubscribe function. */
	subscribe(listener: UavAgentEventListener): () => void;
	/** Emit an event to all subscribers (used by the runtime for error events). */
	emit(event: UavAgentEvent): void;
	/** Release backend resources. */
	close(): Promise<void>;
}

/** Creates session backends for the runtime. */
export interface UavSessionFactory {
	/**
	 * Create (or resume) a session backend. Implementations restore existing
	 * persisted sessions by id instead of always starting fresh.
	 */
	create(options: CreateSessionOptions): Promise<UavSessionBackend>;
}

/** Thrown when a session id is unknown. */
export class UnknownSessionError extends Error {
	readonly sessionId: string;

	constructor(sessionId: string) {
		super(`Unknown session: ${sessionId}`);
		this.name = "UnknownSessionError";
		this.sessionId = sessionId;
	}
}

/** Thrown when creating a session with an id that is already running. */
export class SessionExistsError extends Error {
	readonly sessionId: string;

	constructor(sessionId: string) {
		super(`Session already exists: ${sessionId}. Use resumeSession() to reuse it.`);
		this.name = "SessionExistsError";
		this.sessionId = sessionId;
	}
}

export class SessionRegistry {
	private readonly sessions = new Map<string, UavSessionBackend>();
	private readonly factory: UavSessionFactory;

	constructor(factory: UavSessionFactory) {
		this.factory = factory;
	}

	/**
	 * Create a new session and register it.
	 * @throws {SessionExistsError} when the id is already running.
	 */
	async create(options: CreateSessionOptions = {}): Promise<string> {
		const id = options.sessionId ?? `uav-${randomUUID()}`;
		if (this.sessions.has(id)) {
			throw new SessionExistsError(id);
		}
		const backend = await this.factory.create({ ...options, sessionId: id });
		this.sessions.set(id, backend);
		return id;
	}

	/**
	 * Resume a session: reuse the running backend when present, otherwise
	 * create it (restoring persisted history when the factory supports it).
	 */
	async resume(options: CreateSessionOptions): Promise<string> {
		const id = options.sessionId ?? `uav-${randomUUID()}`;
		const existing = this.sessions.get(id);
		if (existing !== undefined) {
			return id;
		}
		const backend = await this.factory.create({ ...options, sessionId: id });
		this.sessions.set(id, backend);
		return id;
	}

	get(sessionId: string): UavSessionBackend {
		const backend = this.sessions.get(sessionId);
		if (backend === undefined) {
			throw new UnknownSessionError(sessionId);
		}
		return backend;
	}

	has(sessionId: string): boolean {
		return this.sessions.has(sessionId);
	}

	list(): string[] {
		return Array.from(this.sessions.keys());
	}

	get size(): number {
		return this.sessions.size;
	}

	/** Close and remove a session. Returns false if it did not exist. */
	async remove(sessionId: string): Promise<boolean> {
		const backend = this.sessions.get(sessionId);
		if (backend === undefined) {
			return false;
		}
		this.sessions.delete(sessionId);
		await backend.close();
		return true;
	}

	/** Close and remove all sessions. */
	async closeAll(): Promise<void> {
		const backends = Array.from(this.sessions.values());
		this.sessions.clear();
		await Promise.allSettled(backends.map((backend) => backend.close()));
	}
}
