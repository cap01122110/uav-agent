/**
 * Runtime validation helpers for platform responses.
 *
 * TypeScript annotations stop at compile time; the platform is an external
 * Java service, so every payload is validated here before it is trusted.
 * A reachable platform answering with a malformed payload must surface as
 * INVALID_RESPONSE, never degrade into "offline" / "empty" / "not found"
 * defaults.
 *
 * Context strings in errors name the endpoint and field path only
 * (e.g. "jobList.data.pagination.page") - never raw payload bytes, tokens,
 * headers or stack traces.
 */

import { PlatformError } from "./errors.ts";

/** Build the stable INVALID_RESPONSE error for a validated field path. */
export function invalidResponse(context: string): PlatformError {
	return new PlatformError({
		code: "INVALID_RESPONSE",
		message: `UAV platform returned an invalid response (${context}).`,
		retryable: false,
	});
}

export function requireRecord(value: unknown, context: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw invalidResponse(context);
	}
	return value as Record<string, unknown>;
}

export function requireArray(value: unknown, context: string): unknown[] {
	if (!Array.isArray(value)) {
		throw invalidResponse(context);
	}
	return value;
}

/** Require a finite integer >= `minimum`. */
export function requireInteger(value: unknown, context: string, minimum: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
		throw invalidResponse(context);
	}
	return value;
}

export function requireString(value: unknown, context: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw invalidResponse(context);
	}
	return value;
}

/**
 * Envelope `code` per the platform contract: a finite number (numeric strings
 * tolerated). A missing or non-numeric code is a contract violation, not a
 * success.
 */
export function requireEnvelopeCode(record: Record<string, unknown>, context: string): number {
	const raw = record.code;
	if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
	throw invalidResponse(`${context}.code`);
}

/**
 * Coerce one wire boolean (true/false, 1/0, "true"/"false", "online"/"offline",
 * ...). Numeric wire values follow the 0/1 contract only: any other number
 * (2, -1, 1.5, NaN, Infinity) is unrecognizable and returns undefined, so a
 * malformed status can never read as a safe online=true. The caller decides
 * whether undefined is allowed; it must never be turned into `false` for
 * real-time device state.
 */
export function asWireBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (value === 0) return false;
		if (value === 1) return true;
		return undefined;
	}
	if (typeof value === "string") {
		const normalized = value.toLowerCase();
		if (normalized === "true" || normalized === "1" || normalized === "online" || normalized === "running") {
			return true;
		}
		if (normalized === "false" || normalized === "0" || normalized === "offline" || normalized === "stopped") {
			return false;
		}
	}
	return undefined;
}
