/**
 * Stable public error messages for the UAV platform client.
 *
 * Upstream (the Java platform) may answer with raw body text, stack traces,
 * SQL errors or credentials in its error pages. None of that may reach the
 * model, tool results or TUI. Every PlatformError the client raises carries a
 * message generated here - a short, stable description of the *category* of
 * failure - while machine-readable facts live on the error's structured
 * fields (code, status, requestId, retryable).
 */

import type { PlatformErrorCode } from "./errors.ts";

/** Public message for an HTTP failure status; never includes the response body. */
export function httpErrorMessage(status: number): string {
	if (status === 400) return "UAV platform rejected the request.";
	if (status === 401 || status === 403) return "UAV platform permission denied.";
	if (status === 404) return "UAV platform resource not found.";
	if (status === 408 || status === 504) return "UAV platform request timed out.";
	if (status === 429 || (status >= 500 && status <= 599)) return "UAV platform is unavailable.";
	return "UAV platform request failed.";
}

/** Public message for a business/validation error code. */
export function platformErrorMessage(code: PlatformErrorCode): string {
	switch (code) {
		case "AIRPORT_NOT_FOUND":
			return "Airport not found.";
		case "DRONE_NOT_FOUND":
			return "Drone not found.";
		case "AIRPORT_OFFLINE":
			return "Airport is offline.";
		case "DRONE_OFFLINE":
			return "Drone is offline.";
		case "MISSION_NOT_FOUND":
			return "Mission not found.";
		case "INVALID_RESPONSE":
			return "UAV platform returned an invalid response.";
		case "PERMISSION_DENIED":
			return "UAV platform permission denied.";
		case "UPSTREAM_TIMEOUT":
			return "UAV platform request timed out.";
		case "PLATFORM_UNAVAILABLE":
			return "UAV platform is unavailable.";
		case "INVALID_REQUEST":
			return "UAV platform rejected the request.";
		case "UNKNOWN_ERROR":
			return "UAV platform request failed.";
	}
}
