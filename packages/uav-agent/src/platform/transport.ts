/**
 * HTTP transport used by UavPlatformClient.
 *
 * Owns raw fetch concerns: timeout, abort propagation, request ids, JSON
 * parsing, and stable error mapping. Never throws raw network errors.
 *
 * Invariants:
 * - An already-aborted signal never issues a request.
 * - The timeout covers the full request including response body reads.
 * - Timeout values must be finite positive numbers.
 * - Public error messages are stable and never embed the response body,
 *   upstream text, credentials or stack traces; the raw body is discarded.
 */

import { randomUUID } from "node:crypto";
import { httpErrorMessage } from "./error-message.ts";
import { isRetryableStatus, mapHttpStatus, PlatformError, type PlatformErrorCode } from "./errors.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface TransportRequestOptions {
	method: HttpMethod;
	/** Absolute URL including base URL and path. */
	url: string;
	query?: Record<string, string | number | boolean | undefined>;
	headers?: Record<string, string>;
	/** JSON body. Objects are serialized; strings are sent as-is. */
	body?: unknown;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export interface HttpTransport {
	request<T>(options: TransportRequestOptions): Promise<T>;
}

function assertFinitePositiveTimeout(timeoutMs: number, label: string): void {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new Error(`${label} must be a finite positive number, got ${timeoutMs}`);
	}
}

export class FetchHttpTransport implements HttpTransport {
	private readonly timeoutMs: number;
	private readonly onRequestId?: (requestId: string) => void;

	constructor(options: { timeoutMs?: number; onRequestId?: (requestId: string) => void } = {}) {
		const timeoutMs = options.timeoutMs ?? 15_000;
		assertFinitePositiveTimeout(timeoutMs, "timeoutMs");
		this.timeoutMs = timeoutMs;
		this.onRequestId = options.onRequestId;
	}

	async request<T>(options: TransportRequestOptions): Promise<T> {
		// Never issue a request after the caller already aborted.
		if (options.signal?.aborted) {
			throw new DOMException("The operation was aborted", "AbortError");
		}
		const requestId = randomUUID();
		this.onRequestId?.(requestId);

		const queryString = buildQueryString(options.query);
		const url =
			queryString.length > 0 ? `${options.url}${options.url.includes("?") ? "&" : "?"}${queryString}` : options.url;
		const headers: Record<string, string> = {
			accept: "application/json",
			"x-request-id": requestId,
			...(options.headers ?? {}),
		};
		const body = serializeBody(options.body);
		if (body !== undefined && headers["content-type"] === undefined) {
			headers["content-type"] = "application/json";
		}

		const timeoutMs = options.timeoutMs ?? this.timeoutMs;
		assertFinitePositiveTimeout(timeoutMs, "timeoutMs");

		const controller = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
		const onAbort = () => controller.abort();
		options.signal?.addEventListener("abort", onAbort, { once: true });

		try {
			const response = await fetch(url, { method: options.method, headers, body, signal: controller.signal });
			if (!response.ok) {
				throw await createHttpError(response, requestId);
			}
			// Body read + JSON parsing stay inside the timeout window.
			return await parseResponse<T>(response, requestId);
		} catch (error) {
			if (options.signal?.aborted) {
				throw error;
			}
			if (timedOut) {
				throw new PlatformError(
					{ code: "UPSTREAM_TIMEOUT", message: "UAV platform request timed out.", retryable: true },
					{ requestId, cause: error },
				);
			}
			if (error instanceof PlatformError) {
				throw error;
			}
			throw new PlatformError(
				{ code: "PLATFORM_UNAVAILABLE", message: "UAV platform is unavailable.", retryable: true },
				{ requestId, cause: error },
			);
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
		}
	}
}

function buildQueryString(query: Record<string, string | number | boolean | undefined> | undefined): string {
	if (query === undefined) return "";
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined) continue;
		params.append(key, String(value));
	}
	return params.toString();
}

function serializeBody(body: unknown): string | undefined {
	if (body === undefined) return undefined;
	if (typeof body === "string") return body;
	return JSON.stringify(body);
}

/**
 * Build the error for a non-2xx HTTP response. The public message is a stable
 * per-status text; the response body (which may embed credentials, SQL or
 * stack traces) is deliberately never read or included.
 */
function createHttpError(response: Response, requestId: string): PlatformError {
	const code: PlatformErrorCode = mapHttpStatus(response.status) ?? "UNKNOWN_ERROR";
	return new PlatformError(
		{ code, message: httpErrorMessage(response.status), retryable: isRetryableStatus(response.status) },
		{ status: response.status, requestId, cause: new Error(`HTTP ${response.status}`) },
	);
}

async function parseResponse<T>(response: Response, requestId: string): Promise<T> {
	const text = await response.text();
	if (text.length === 0) {
		return undefined as T;
	}
	try {
		return JSON.parse(text) as T;
	} catch {
		// HTTP succeeded but the body is not valid JSON: the upstream contract
		// is broken. The raw body is never included in the public message.
		throw new PlatformError(
			{ code: "INVALID_RESPONSE", message: "UAV platform returned an invalid response.", retryable: false },
			{ status: response.status, requestId },
		);
	}
}
