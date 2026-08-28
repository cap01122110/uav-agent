/**
 * Unified platform error model.
 *
 * PlatformClient never throws raw HTTP/network errors at the model. Every
 * failure is normalized to a stable code with a retryable flag.
 */

export type PlatformErrorCode =
	| "AIRPORT_NOT_FOUND"
	| "DRONE_NOT_FOUND"
	| "AIRPORT_OFFLINE"
	| "DRONE_OFFLINE"
	| "MISSION_NOT_FOUND"
	| "INVALID_RESPONSE"
	| "PERMISSION_DENIED"
	| "UPSTREAM_TIMEOUT"
	| "PLATFORM_UNAVAILABLE"
	| "INVALID_REQUEST"
	| "UNKNOWN_ERROR";

export interface PlatformErrorInfo {
	code: PlatformErrorCode;
	message: string;
	retryable: boolean;
}

export class PlatformError extends Error {
	readonly code: PlatformErrorCode;
	readonly retryable: boolean;
	/** HTTP status when the failure came from an HTTP response. */
	readonly status?: number;
	/** Request id sent to / returned by the platform. */
	readonly requestId?: string;

	constructor(info: PlatformErrorInfo, options: { status?: number; requestId?: string; cause?: unknown } = {}) {
		super(info.message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "PlatformError";
		this.code = info.code;
		this.retryable = info.retryable;
		this.status = options.status;
		this.requestId = options.requestId;
	}

	toInfo(): PlatformErrorInfo {
		return { code: this.code, message: this.message, retryable: this.retryable };
	}
}

/** Map an HTTP status to a stable error code, if one applies generically. */
export function mapHttpStatus(status: number): PlatformErrorCode | undefined {
	switch (status) {
		case 400:
			return "INVALID_REQUEST";
		case 401:
		case 403:
			return "PERMISSION_DENIED";
		case 408:
		case 504:
			return "UPSTREAM_TIMEOUT";
		case 429:
			return "PLATFORM_UNAVAILABLE";
		case 500:
		case 502:
		case 503:
			return "PLATFORM_UNAVAILABLE";
		default:
			return undefined;
	}
}

/** Whether a status should be retried by the agent. */
export function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
