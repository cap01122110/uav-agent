import { describe, expect, it, type vi } from "vitest";
import type { UavCapabilityClient } from "../../src/capability/client.ts";
import { PlatformError } from "../../src/platform/errors.ts";
import { getAirportStatusTool } from "../../src/tools/airport/get-airport-status.ts";
import { createFakeCapability } from "../helpers/fake-capability.ts";
import { fakeExtensionContext, firstText } from "../helpers/tools.ts";

function createCapabilityWithStatus(airportStatus: unknown): UavCapabilityClient {
	const capabilities = createFakeCapability();
	(capabilities.getAirportStatus as ReturnType<typeof vi.fn>).mockResolvedValue(airportStatus);
	return capabilities;
}

function createFailingCapability(error: Error): UavCapabilityClient {
	const capabilities = createFakeCapability();
	(capabilities.getAirportStatus as ReturnType<typeof vi.fn>).mockRejectedValue(error);
	return capabilities;
}

describe("get_airport_status tool", () => {
	it("has a valid TypeBox schema requiring airportId", () => {
		const tool = getAirportStatusTool(createFakeCapability());
		expect(tool.name).toBe("get_airport_status");
		const schema = tool.parameters;
		const properties = (schema as { properties?: Record<string, unknown> }).properties;
		expect(properties?.airportId).toBeDefined();
		expect((schema as { required?: string[] }).required).toContain("airportId");
	});

	it("calls the capability client and returns the status as JSON", async () => {
		const status = { airportId: "Test-01", online: true, battery: 90 };
		const capabilities = createCapabilityWithStatus(status);
		const tool = getAirportStatusTool(capabilities);
		const result = await tool.execute(
			"call-1",
			{ airportId: "Test-01" },
			undefined,
			undefined,
			fakeExtensionContext(),
		);
		expect(capabilities.getAirportStatus).toHaveBeenCalledWith({ airportId: "Test-01" }, undefined);
		expect(JSON.parse(firstText(result))).toEqual(status);
		expect(result.details).toEqual(status);
	});

	it("propagates platform errors to the model accurately", async () => {
		const capabilities = createFailingCapability(
			new PlatformError({ code: "AIRPORT_NOT_FOUND", message: "Airport not found: X", retryable: false }),
		);
		const tool = getAirportStatusTool(capabilities);
		await expect(
			tool.execute("call-1", { airportId: "X" }, undefined, undefined, fakeExtensionContext()),
		).rejects.toThrow(/Airport not found/);
	});
});
