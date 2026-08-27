import { describe, expect, it, vi } from "vitest";
import type { UavPlatformClient } from "../../src/platform/client.ts";
import { PlatformError } from "../../src/platform/errors.ts";
import { getAirportStatusTool } from "../../src/tools/airport/get-airport-status.ts";
import { fakeExtensionContext, firstText } from "../helpers/tools.ts";

function createPlatform(airportStatus: unknown): UavPlatformClient {
	return {
		airport: { getStatus: vi.fn(async () => airportStatus) },
		drone: { getStatus: vi.fn() },
		mission: { getStatus: vi.fn() },
		safety: { preflightCheck: vi.fn() },
	} as unknown as UavPlatformClient;
}

function createFailingPlatform(error: Error): UavPlatformClient {
	return {
		airport: { getStatus: vi.fn(async () => Promise.reject(error)) },
		drone: { getStatus: vi.fn() },
		mission: { getStatus: vi.fn() },
		safety: { preflightCheck: vi.fn() },
	} as unknown as UavPlatformClient;
}

describe("get_airport_status tool", () => {
	it("has a valid TypeBox schema requiring airportId", () => {
		const tool = getAirportStatusTool(createPlatform({}));
		expect(tool.name).toBe("get_airport_status");
		const schema = tool.parameters;
		const properties = (schema as { properties?: Record<string, unknown> }).properties;
		expect(properties?.airportId).toBeDefined();
		expect((schema as { required?: string[] }).required).toContain("airportId");
	});

	it("calls the platform client and returns the status as JSON", async () => {
		const status = { airportId: "Test-01", online: true, battery: 90 };
		const platform = createPlatform(status);
		const tool = getAirportStatusTool(platform);
		const result = await tool.execute(
			"call-1",
			{ airportId: "Test-01" },
			undefined,
			undefined,
			fakeExtensionContext(),
		);
		expect(platform.airport.getStatus).toHaveBeenCalledWith("Test-01", undefined);
		expect(JSON.parse(firstText(result))).toEqual(status);
		expect(result.details).toEqual(status);
	});

	it("propagates platform errors to the model accurately", async () => {
		const platform = createFailingPlatform(
			new PlatformError({ code: "AIRPORT_NOT_FOUND", message: "Airport not found: X", retryable: false }),
		);
		const tool = getAirportStatusTool(platform);
		await expect(
			tool.execute("call-1", { airportId: "X" }, undefined, undefined, fakeExtensionContext()),
		).rejects.toThrow(/Airport not found/);
	});
});
