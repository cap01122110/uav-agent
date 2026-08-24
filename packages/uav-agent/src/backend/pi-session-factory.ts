/**
 * Pi session factory.
 *
 * Creates coding-agent AgentSessions behind the UAV session abstraction. The
 * factory owns pi resource wiring: model runtime, settings, resource loader
 * (extensions/skills disabled, UAV system prompt injected), session
 * persistence, and tool configuration.
 *
 * Sessions are persisted as JSONL files. Creating a session with an id that
 * already has persisted history restores that history instead of starting
 * fresh (the TUI default "local-default" resumes across restarts).
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	getAgentDir,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentContext } from "../core/context.ts";
import type {
	CreateSessionOptions,
	SessionContext,
	UavSessionBackend,
	UavSessionFactory,
} from "../core/session-registry.ts";
import { UAV_SYSTEM_PROMPT } from "../prompt/system.ts";
import { PiSessionBackend } from "./pi-session-backend.ts";

export interface PiSessionFactoryOptions {
	/** Working directory used by the pi runtime. Defaults to process.cwd(). */
	cwd?: string;
	/** Global pi config directory. Defaults to the standard pi agent dir. */
	agentDir?: string;
	/** Directory for persisted session JSONL files. Defaults to <agentDir>/uav-sessions. */
	sessionDir?: string;
	/** System prompt injected into every session. Defaults to the UAV prompt. */
	systemPrompt?: string;
	/** UAV tools registered as pi custom tools. */
	customTools?: ToolDefinition[];
	/** Tool suppression mode passed to pi. "builtin" disables coding tools. */
	noTools?: "builtin" | "all";
}

export class PiSessionFactory implements UavSessionFactory {
	private readonly cwd: string;
	private readonly agentDir: string;
	private readonly sessionDir: string;
	private readonly systemPrompt: string;
	private readonly customTools: ToolDefinition[];
	private readonly noTools: "builtin" | "all";

	constructor(options: PiSessionFactoryOptions = {}) {
		this.cwd = options.cwd ?? process.cwd();
		this.agentDir = options.agentDir ?? getAgentDir();
		this.sessionDir = options.sessionDir ?? join(this.agentDir, "uav-sessions");
		this.systemPrompt = options.systemPrompt ?? UAV_SYSTEM_PROMPT;
		this.customTools = options.customTools ?? [];
		this.noTools = options.noTools ?? "builtin";
	}

	async create(options: CreateSessionOptions = {}): Promise<UavSessionBackend> {
		const sessionId = options.sessionId ?? this.generateSessionId();
		const context: AgentContext = {
			sessionId,
			userId: options.userId ?? "local-user",
			tenantId: options.tenantId,
			channel: options.channel ?? "tui",
		};
		const services = await createAgentSessionServices({
			cwd: this.cwd,
			agentDir: this.agentDir,
			resourceLoaderOptions: {
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				systemPrompt: this.systemPrompt,
				// Block APPEND_SYSTEM.md files from <cwd>/.pi or the agent dir; the
				// UAV prompt must not be polluted by coding-oriented appends.
				appendSystemPromptOverride: () => [],
			},
		});
		const sessionManager = await this.restoreOrCreateSessionManager(sessionId);
		const { session } = await createAgentSessionFromServices({
			services,
			sessionManager,
			noTools: this.noTools,
			// Explicit allowlist: the model only sees the registered UAV tools.
			tools: this.customTools.map((tool) => tool.name),
			customTools: this.customTools,
			sessionStartEvent: {
				type: "session_start",
				reason: sessionManager.isPersisted() && sessionManager.getEntries().length > 0 ? "resume" : "startup",
			},
		});
		return new PiSessionBackend(sessionId, session, context as SessionContext);
	}

	/**
	 * Reuse persisted JSONL history for a session id when present, otherwise
	 * create a fresh session file.
	 */
	private async restoreOrCreateSessionManager(sessionId: string): Promise<SessionManager> {
		const sessions = await SessionManager.list(this.cwd, this.sessionDir);
		const existing = sessions.find((info) => info.id === sessionId);
		if (existing !== undefined) {
			return SessionManager.open(existing.path, this.sessionDir, this.cwd);
		}
		return SessionManager.create(this.cwd, this.sessionDir, { id: sessionId });
	}

	private generateSessionId(): string {
		return `uav-${randomUUID()}`;
	}
}
