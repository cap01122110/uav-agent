/**
 * Token provider for the business platform.
 *
 * Chain: LLM -> Tool -> PlatformClient -> TokenProvider -> Business Platform.
 *
 * Secrets (client secret) must never:
 * - enter the prompt or tool results
 * - be logged in full
 * - be hardcoded in source
 *
 * Phase 1 uses agent service identity. User delegation slots in behind the
 * same TokenProvider interface later without touching tools.
 */

import { PlatformError } from "../platform/errors.ts";
import { redactThenTruncate } from "./redaction.ts";

/** Supplies a bearer token for platform requests. */
export interface TokenProvider {
	getToken(signal?: AbortSignal): Promise<string>;
}

export interface Token {
	value: string;
	expiresAt: number;
}

/** Acquires a fresh token from an external source. */
export interface TokenSource {
	fetchToken(signal?: AbortSignal): Promise<Token>;
}

const REFRESH_MARGIN_MS = 30_000;

/** Caches tokens and refreshes them shortly before expiry. */
export class CachedTokenProvider implements TokenProvider {
	private readonly source: TokenSource;
	private readonly clock: () => number;
	private cached: Token | undefined;
	private fetching: Promise<Token> | undefined;

	constructor(source: TokenSource, clock: () => number = () => Date.now()) {
		this.source = source;
		this.clock = clock;
	}

	async getToken(_signal?: AbortSignal): Promise<string> {
		const now = this.clock();
		if (this.cached && this.cached.expiresAt > now + REFRESH_MARGIN_MS) {
			return this.cached.value;
		}
		if (this.fetching === undefined) {
			// Deliberately not bound to the caller's signal: one session aborting
			// must not cancel the shared refresh for other sessions. The token
			// source applies its own internal timeout.
			this.fetching = this.source.fetchToken().then((token) => {
				this.cached = token;
				return token;
			});
		}
		try {
			const token = await this.fetching;
			return token.value;
		} finally {
			this.fetching = undefined;
		}
	}
}

export interface ClientCredentialsOptions {
	tokenUrl: string;
	clientId: string;
	clientSecret: string;
	scopes?: string[];
	timeoutMs?: number;
}

/** OAuth2 client-credentials token source. */
export class ClientCredentialsTokenSource implements TokenSource {
	private readonly options: ClientCredentialsOptions;

	constructor(options: ClientCredentialsOptions) {
		this.options = options;
	}

	async fetchToken(signal?: AbortSignal): Promise<Token> {
		if (signal?.aborted) {
			throw new DOMException("The operation was aborted", "AbortError");
		}
		const body = new URLSearchParams({
			grant_type: "client_credentials",
			client_id: this.options.clientId,
			client_secret: this.options.clientSecret,
		});
		for (const scope of this.options.scopes ?? []) {
			body.append("scope", scope);
		}

		const controller = new AbortController();
		let timedOut = false;
		const timeoutMs = this.options.timeoutMs ?? 10_000;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
		const onAbort = () => controller.abort();
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			const response = await fetch(this.options.tokenUrl, {
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					accept: "application/json",
				},
				body,
				signal: controller.signal,
			});
			if (!response.ok) {
				// Raw body is discarded from the public message; only a redacted
				// fragment may survive on the cause for diagnostics.
				const detail = await readBodyText(response);
				throw new PlatformError(
					{ code: "PERMISSION_DENIED", message: `Token request failed (${response.status})`, retryable: false },
					{ status: response.status, cause: new Error(redactThenTruncate(detail)) },
				);
			}

			const payload = await readJsonResponse<{ access_token?: unknown; expires_in?: unknown }>(
				response,
				"Token endpoint returned an invalid response",
			);
			if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
				throw new PlatformError({
					code: "INVALID_RESPONSE",
					message: "Token endpoint returned no access_token",
					retryable: false,
				});
			}
			const expiresIn =
				typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) ? payload.expires_in : 3600;
			return { value: payload.access_token, expiresAt: Date.now() + expiresIn * 1000 };
		} catch (error) {
			if (signal?.aborted) throw error;
			if (timedOut) {
				throw new PlatformError(
					{ code: "UPSTREAM_TIMEOUT", message: "Token request timed out.", retryable: true },
					{ cause: error },
				);
			}
			if (error instanceof PlatformError) throw error;
			throw new PlatformError(
				{ code: "PLATFORM_UNAVAILABLE", message: "Token endpoint unreachable", retryable: true },
				{ cause: error },
			);
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		}
	}
}

/** Static token source for development / deployments with pre-issued tokens. */
export class StaticTokenSource implements TokenSource {
	private readonly token: string;

	constructor(token: string) {
		this.token = token;
	}

	async fetchToken(): Promise<Token> {
		return { value: this.token, expiresAt: Number.POSITIVE_INFINITY };
	}
}

/**
 * Password/JWT token source for platforms that issue JWTs from a login
 * endpoint (agent service identity expressed as username/password).
 *
 * Expected platform response envelope: { code: 0, message, data }. `data` is
 * either a JWT string or an object carrying it under a common key.
 */
export interface PasswordTokenSourceOptions {
	baseUrl: string;
	username: string;
	password: string;
	/** Login endpoint. Defaults to /manage/api/v1/getToken. */
	loginPath?: string;
	timeoutMs?: number;
}

const DEFAULT_LOGIN_PATH = "/manage/api/v1/getToken";

function extractJwt(data: unknown): string | undefined {
	if (typeof data === "string" && data.length > 0) return data;
	if (typeof data === "object" && data !== null) {
		const record = data as Record<string, unknown>;
		for (const key of ["x-auth-token", "token", "accessToken", "access_token", "jwt"]) {
			const value = record[key];
			if (typeof value === "string" && value.length > 0) return value;
		}
	}
	return undefined;
}

/** Decode the exp claim of a JWT without verifying the signature. */
function jwtExpiryMs(jwt: string): number | undefined {
	const payloadPart = jwt.split(".")[1];
	if (payloadPart === undefined) return undefined;
	try {
		const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
		const payload = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as { exp?: unknown };
		if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
			return payload.exp * 1000;
		}
	} catch {
		// Not a decodable JWT payload; caller falls back to a default TTL.
	}
	return undefined;
}

const DEFAULT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/** Token source that logs in with username/password and caches the JWT. */
export class PasswordTokenSource implements TokenSource {
	private readonly options: PasswordTokenSourceOptions;

	constructor(options: PasswordTokenSourceOptions) {
		this.options = options;
	}

	async fetchToken(signal?: AbortSignal): Promise<Token> {
		if (signal?.aborted) {
			throw new DOMException("The operation was aborted", "AbortError");
		}
		const controller = new AbortController();
		let timedOut = false;
		const timeoutMs = this.options.timeoutMs ?? 10_000;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
		const onAbort = () => controller.abort();
		signal?.addEventListener("abort", onAbort, { once: true });

		const url = `${this.options.baseUrl.replace(/\/+$/, "")}${this.options.loginPath ?? DEFAULT_LOGIN_PATH}`;
		const body = JSON.stringify({ username: this.options.username, password: this.options.password });

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json", accept: "application/json" },
				body,
				signal: controller.signal,
			});
			if (!response.ok) {
				const detail = await readBodyText(response);
				throw new PlatformError(
					{ code: "PERMISSION_DENIED", message: `Login failed (${response.status})`, retryable: false },
					{ status: response.status, cause: new Error(redactThenTruncate(detail)) },
				);
			}

			const payload = await readJsonResponse<{ code?: unknown; message?: unknown; data?: unknown }>(
				response,
				"Login endpoint returned an invalid response",
			);
			if (payload.code !== 0) {
				// The upstream login message is untrusted text; never expose it.
				throw new PlatformError({
					code: "PERMISSION_DENIED",
					message: "Login failed",
					retryable: false,
				});
			}
			const token = extractJwt(payload.data);
			if (token === undefined) {
				throw new PlatformError({
					code: "INVALID_RESPONSE",
					message: "Login response contained no token",
					retryable: false,
				});
			}
			return {
				value: token,
				expiresAt: jwtExpiryMs(token) ?? Date.now() + DEFAULT_TOKEN_TTL_MS,
			};
		} catch (error) {
			if (signal?.aborted) throw error;
			if (timedOut) {
				throw new PlatformError(
					{ code: "UPSTREAM_TIMEOUT", message: "Login request timed out.", retryable: true },
					{ cause: error },
				);
			}
			if (error instanceof PlatformError) throw error;
			throw new PlatformError(
				{ code: "PLATFORM_UNAVAILABLE", message: "Login endpoint unreachable", retryable: true },
				{ cause: error },
			);
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		}
	}
}

/** Whether an error is a caller/transport abort (DOMException AbortError). */
function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

/** Read the raw body for diagnostics, but never swallow a caller abort. */
async function readBodyText(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch (error) {
		if (isAbortError(error)) throw error;
		return "";
	}
}

/** Parse a JSON response; a contract violation maps to INVALID_RESPONSE. */
async function readJsonResponse<T>(response: Response, publicMessage: string): Promise<T> {
	try {
		return JSON.parse(await response.text()) as T;
	} catch (error) {
		if (isAbortError(error)) throw error;
		throw new PlatformError({ code: "INVALID_RESPONSE", message: publicMessage, retryable: false }, { cause: error });
	}
}
