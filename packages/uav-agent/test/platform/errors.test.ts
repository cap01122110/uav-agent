import { describe, expect, it } from "vitest";
import { isRetryableStatus, mapHttpStatus, PlatformError } from "../../src/platform/errors.ts";

describe("mapHttpStatus", () => {
	it("maps client/server statuses to stable codes", () => {
		expect(mapHttpStatus(400)).toBe("INVALID_REQUEST");
		expect(mapHttpStatus(401)).toBe("PERMISSION_DENIED");
		expect(mapHttpStatus(403)).toBe("PERMISSION_DENIED");
		expect(mapHttpStatus(408)).toBe("UPSTREAM_TIMEOUT");
		expect(mapHttpStatus(429)).toBe("PLATFORM_UNAVAILABLE");
		expect(mapHttpStatus(500)).toBe("PLATFORM_UNAVAILABLE");
		expect(mapHttpStatus(502)).toBe("PLATFORM_UNAVAILABLE");
		expect(mapHttpStatus(503)).toBe("PLATFORM_UNAVAILABLE");
		expect(mapHttpStatus(504)).toBe("UPSTREAM_TIMEOUT");
	});

	it("returns undefined for unmapped statuses", () => {
		expect(mapHttpStatus(404)).toBeUndefined();
		expect(mapHttpStatus(418)).toBeUndefined();
	});

	it("marks retryable statuses", () => {
		expect(isRetryableStatus(429)).toBe(true);
		expect(isRetryableStatus(503)).toBe(true);
		expect(isRetryableStatus(401)).toBe(false);
	});
});

describe("PlatformError", () => {
	it("carries code, retryable flag and toInfo", () => {
		const error = new PlatformError(
			{ code: "AIRPORT_NOT_FOUND", message: "no such airport", retryable: false },
			{ status: 404 },
		);
		expect(error.code).toBe("AIRPORT_NOT_FOUND");
		expect(error.status).toBe(404);
		expect(error.retryable).toBe(false);
		expect(error.toInfo()).toEqual({ code: "AIRPORT_NOT_FOUND", message: "no such airport", retryable: false });
	});
});
