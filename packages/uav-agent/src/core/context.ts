/**
 * Agent context passed through the runtime for every session.
 *
 * Identity and channel information lives here so tools and platform clients
 * never read UI state. Future web/API adapters supply their own context values
 * without touching tools or the platform client.
 */

export type AgentChannel = "tui" | "web" | "api";

export interface AgentContext {
	/** Stable runtime session id. */
	sessionId: string;
	/** End-user id. TUI currently uses "local-user". */
	userId: string;
	/** Optional tenant/workspace id for multi-tenant deployments. */
	tenantId?: string;
	/** Channel the session was created on. */
	channel: AgentChannel;
}
