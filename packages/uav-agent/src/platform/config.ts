/**
 * Platform configuration from the environment.
 *
 * Secrets (UAV_AGENT_CLIENT_SECRET) are read from the environment only. They
 * never enter the prompt, tool results, logs, or source.
 *
 * Auth contract: the real Java platform authenticates with a username/password
 * login (agent service identity), so UAV_AGENT_CLIENT_ID/SECRET map to the
 * login username/password. OAuth2 client_credentials is NOT used here.
 */

import {
	CachedTokenProvider,
	PasswordTokenSource,
	StaticTokenSource,
	type TokenProvider,
} from "../auth/token-provider.ts";
import { HttpPlatformClient, type UavPlatformClient } from "./client.ts";

export interface UavPlatformConfig {
	/** Business platform base URL (required). */
	baseUrl: string;
	/** Agent service identity client id (used as login username). */
	clientId?: string;
	/** Agent service identity client secret (never logged; used as login password). */
	clientSecret?: string;
	/** Pre-issued static token; takes precedence over other methods. */
	token?: string;
	/** Request timeout in milliseconds. */
	timeoutMs?: number;
	/** Workspace id required by the platform REST API. */
	workspaceId?: string;
}

/** Read platform configuration from environment variables. */
export function loadPlatformConfig(env: Record<string, string | undefined> = process.env): UavPlatformConfig {
	return {
		baseUrl: env.UAV_PLATFORM_URL ?? "",
		clientId: env.UAV_AGENT_CLIENT_ID,
		clientSecret: env.UAV_AGENT_CLIENT_SECRET,
		token: env.UAV_PLATFORM_TOKEN,
		timeoutMs: env.UAV_PLATFORM_TIMEOUT_MS ? Number(env.UAV_PLATFORM_TIMEOUT_MS) : undefined,
		workspaceId: env.UAV_WORKSPACE_ID,
	};
}

/** Build a token provider from a config. */
export function createTokenProvider(config: UavPlatformConfig): TokenProvider {
	if (config.token !== undefined && config.token.length > 0) {
		return new CachedTokenProvider(new StaticTokenSource(config.token));
	}
	if (config.clientId !== undefined && config.clientSecret !== undefined) {
		return new CachedTokenProvider(
			new PasswordTokenSource({
				baseUrl: config.baseUrl,
				username: config.clientId,
				password: config.clientSecret,
				timeoutMs: config.timeoutMs,
			}),
		);
	}
	throw new Error(
		"Missing platform credentials: set UAV_PLATFORM_TOKEN or both UAV_AGENT_CLIENT_ID and UAV_AGENT_CLIENT_SECRET",
	);
}

/** Create a fully configured platform client from environment variables. */
export function createPlatformClientFromEnv(env: Record<string, string | undefined> = process.env): UavPlatformClient {
	const config = loadPlatformConfig(env);
	if (config.baseUrl.length === 0) {
		throw new Error("Missing UAV_PLATFORM_URL");
	}
	return new HttpPlatformClient({
		baseUrl: config.baseUrl,
		tokenProvider: createTokenProvider(config),
		timeoutMs: config.timeoutMs,
		workspaceId: config.workspaceId,
	});
}
