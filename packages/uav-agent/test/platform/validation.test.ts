import { describe, expect, it } from "vitest";
import type { PlatformError } from "../../src/platform/errors.ts";
import {
	asWireBoolean,
	invalidResponse,
	requireArray,
	requireEnvelopeCode,
	requireInteger,
	requireRecord,
	requireString,
} from "../../src/platform/validation.ts";

function expectInvalidResponse(run: () => unknown): void {
	try {
		run();
		expect.unreachable();
	} catch (error) {
		expect((error as PlatformError).code).toBe("INVALID_RESPONSE");
	}
}

describe("asWireBoolean", () => {
	it("accepts boolean true/false", () => {
		expect(asWireBoolean(true)).toBe(true);
		expect(asWireBoolean(false)).toBe(false);
	});

	it("accepts only the numeric 0/1 contract", () => {
		expect(asWireBoolean(0)).toBe(false);
		expect(asWireBoolean(1)).toBe(true);
		// Anything else is unrecognizable, never a safe true.
		expect(asWireBoolean(2)).toBeUndefined();
		expect(asWireBoolean(-1)).toBeUndefined();
		expect(asWireBoolean(1.5)).toBeUndefined();
		expect(asWireBoolean(Number.NaN)).toBeUndefined();
		expect(asWireBoolean(Number.POSITIVE_INFINITY)).toBeUndefined();
		expect(asWireBoolean(99)).toBeUndefined();
	});

	it("accepts known string aliases", () => {
		expect(asWireBoolean("0")).toBe(false);
		expect(asWireBoolean("1")).toBe(true);
		expect(asWireBoolean("true")).toBe(true);
		expect(asWireBoolean("false")).toBe(false);
		expect(asWireBoolean("online")).toBe(true);
		expect(asWireBoolean("offline")).toBe(false);
		expect(asWireBoolean("running")).toBe(true);
		expect(asWireBoolean("stopped")).toBe(false);
	});

	it("returns undefined for unknown strings (never default-to-true)", () => {
		expect(asWireBoolean("")).toBeUndefined();
		expect(asWireBoolean("garbage")).toBeUndefined();
		expect(asWireBoolean("99")).toBeUndefined();
		expect(asWireBoolean("2")).toBeUndefined();
		expect(asWireBoolean(undefined)).toBeUndefined();
		expect(asWireBoolean(null)).toBeUndefined();
	});
});

describe("requireEnvelopeCode", () => {
	it("accepts a finite number or numeric string", () => {
		expect(requireEnvelopeCode({ code: 0 }, "ctx")).toBe(0);
		expect(requireEnvelopeCode({ code: 200 }, "ctx")).toBe(200);
		expect(requireEnvelopeCode({ code: "0" }, "ctx")).toBe(0);
	});

	it("rejects a missing or non-numeric code", () => {
		expectInvalidResponse(() => requireEnvelopeCode({}, "ctx"));
		expectInvalidResponse(() => requireEnvelopeCode({ code: null }, "ctx"));
		expectInvalidResponse(() => requireEnvelopeCode({ code: "abc" }, "ctx"));
		expectInvalidResponse(() => requireEnvelopeCode({ code: Number.NaN }, "ctx"));
	});
});

describe("guards", () => {
	it("requireRecord accepts objects and rejects non-objects", () => {
		expect(requireRecord({ a: 1 }, "ctx")).toEqual({ a: 1 });
		expectInvalidResponse(() => requireRecord(null, "ctx"));
		expectInvalidResponse(() => requireRecord([], "ctx"));
		expectInvalidResponse(() => requireRecord("x", "ctx"));
	});

	it("requireArray accepts arrays and rejects non-arrays", () => {
		expect(requireArray([1], "ctx")).toEqual([1]);
		expectInvalidResponse(() => requireArray({}, "ctx"));
		expectInvalidResponse(() => requireArray("x", "ctx"));
	});

	it("requireInteger enforces a finite integer >= minimum", () => {
		expect(requireInteger(3, "ctx", 1)).toBe(3);
		expectInvalidResponse(() => requireInteger(1.5, "ctx", 1));
		expectInvalidResponse(() => requireInteger(0, "ctx", 1));
		expectInvalidResponse(() => requireInteger(Number.NaN, "ctx", 1));
		expectInvalidResponse(() => requireInteger("3", "ctx", 1));
	});

	it("requireString enforces a non-empty string", () => {
		expect(requireString("x", "ctx")).toBe("x");
		expectInvalidResponse(() => requireString("", "ctx"));
		expectInvalidResponse(() => requireString(3, "ctx"));
	});

	it("invalidResponse produces the stable code and message", () => {
		const error = invalidResponse("deviceDetail.data.online");
		expect(error.code).toBe("INVALID_RESPONSE");
		expect(error.message).toContain("UAV platform returned an invalid response");
		expect(error.message).toContain("deviceDetail.data.online");
		expect(error.retryable).toBe(false);
	});
});
