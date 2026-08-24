/**
 * HTTP transport used by UavPlatformClient.
 *
 * Owns raw fetch concerns: timeout, abort propagation, request ids, JSON
 * parsing, and stable error mapping. Never throws raw network errors.
 */

import { randomUUID } from "node:crypto";
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

export class FetchHttpTransport implements HttpTransport {
	private readonly timeoutMs: number;
	private readonly onRequestId?: (requestId: string) => void;

	constructor(options: { timeoutMs?: number; onRequestId?: (requestId: string) => void } = {}) {
		this.timeoutMs = options.timeoutMs ?? 15_000;
		this.onRequestId = options.onRequestId;
	}

	async request<T>(options: TransportRequestOptions): Promise<T> {
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

		const controller = new AbortController();
		const timeoutMs = options.timeoutMs ?? this.timeoutMs;
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
		const onAbort = () => controller.abort();
		options.signal?.addEventListener("abort", onAbort, { once: true });

		let response: Response;
		try {
			response = await fetch(url, { method: options.method, headers, body, signal: controller.signal });
		} catch (error) {
			if (options.signal?.aborted) {
				throw error;
			}
			if (timedOut) {
				throw new PlatformError(
					{ code: "UPSTREAM_TIMEOUT", message: `Request timed out after ${timeoutMs}ms`, retryable: true },
					{ requestId, cause: error },
				);
			}
			throw new PlatformError(
				{ code: "PLATFORM_UNAVAILABLE", message: "Platform unreachable", retryable: true },
				{ requestId, cause: error },
			);
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
		}

		if (!response.ok) {
			throw await createHttpError(response, requestId);
		}
		return parseResponse<T>(response, requestId);
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

async function createHttpError(response: Response, requestId: string): Promise<PlatformError> {
	const code: PlatformErrorCode = mapHttpStatus(response.status) ?? "UNKNOWN_ERROR";
	const detail = await readBodyText(response);
	const message =
		detail.length > 0
			? `Platform error ${response.status}: ${truncate(detail)}`
			: `Platform error ${response.status}`;
	return new PlatformError(
		{ code, message, retryable: isRetryableStatus(response.status) },
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
	} catch (error) {
		throw new PlatformError(
			{ code: "UNKNOWN_ERROR", message: "Platform returned invalid JSON", retryable: false },
			{ status: response.status, requestId, cause: error },
		);
	}
}

async function readBodyText(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return "";
	}
}

function truncate(text: string, maxLength = 500): string {
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
