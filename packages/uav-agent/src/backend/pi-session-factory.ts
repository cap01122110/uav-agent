/**
 * Pi session factory.
 *
 * Creates coding-agent AgentSessions behind the UAV session abstraction. The
 * factory owns pi resource wiring: model runtime, settings, resource loader
 * (extensions/skills disabled, UAV system prompt injected), session
 * persistence, and tool configuration.
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
import type { CreateSessionOptions, UavSessionBackend, UavSessionFactory } from "../core/session-registry.ts";
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
			},
		});
		const sessionManager = SessionManager.create(this.cwd, this.sessionDir, { id: sessionId });
		const { session } = await createAgentSessionFromServices({
			services,
			sessionManager,
			noTools: this.noTools,
			customTools: this.customTools,
			sessionStartEvent: { type: "session_start", reason: "startup" },
		});
		return new PiSessionBackend(sessionId, session);
	}

	private generateSessionId(): string {
		return `uav-${randomUUID()}`;
	}
}
