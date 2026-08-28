/**
 * HttpUavCapabilityClient adapter tests.
 *
 * The adapter must only delegate to the platform client: each capability
 * method forwards the domain request (and the AbortSignal) to the matching
 * platform sub-api, returns the platform's result untouched, and lets
 * PlatformError propagate unchanged. It must not swallow errors, re-wrap them,
 * or alter result fields.
 */
import { describe, expect, it, vi } from "vitest";
import { HttpUavCapabilityClient } from "../../src/capability/http-client.ts";
import type { UavPlatformClient } from "../../src/platform/client.ts";
import { PlatformError } from "../../src/platform/errors.ts";
import type {
	AirportStatus,
	DroneStatus,
	MissionStatus,
	PreflightResult,
	ResolvedAirport,
} from "../../src/platform/types.ts";

function createPlatformClient(): UavPlatformClient {
	return {
		airport: {
			getStatus: vi.fn(async (): Promise<AirportStatus> => ({ airportId: "Test-01", online: true })),
			resolve: vi.fn(
				async (): Promise<ResolvedAirport> => ({ airportId: "Test-01", deviceSn: "Test-01", online: true }),
			),
		},
		drone: {
			getStatus: vi.fn(async (): Promise<DroneStatus> => ({ droneSn: "SN", online: true })),
		},
		mission: {
			getStatus: vi.fn(async (): Promise<MissionStatus> => ({ missionId: "M", status: "completed" })),
		},
		safety: {
			preflightCheck: vi.fn(
				async (): Promise<PreflightResult> => ({
					airportId: "A",
					passed: true,
					checks: [{ name: "airport_online", passed: true }],
				}),
			),
		},
	} as unknown as UavPlatformClient;
}

describe("HttpUavCapabilityClient", () => {
	it("resolveAirport delegates to platform.airport.resolve and passes the signal", async () => {
		const platform = createPlatformClient();
		const client = new HttpUavCapabilityClient(platform);
		const signal = new AbortController().signal;
		const result = await client.resolveAirport({ airportId: "Test-01" }, signal);
		expect(platform.airport.resolve).toHaveBeenCalledWith("Test-01", signal);
		expect(result).toEqual({ airportId: "Test-01", deviceSn: "Test-01", online: true });
	});

	it("getAirportStatus delegates to platform.airport.getStatus and passes the signal", async () => {
		const platform = createPlatformClient();
		const client = new HttpUavCapabilityClient(platform);
		const signal = new AbortController().signal;
		const result = await client.getAirportStatus({ airportId: "Test-01" }, signal);
		expect(platform.airport.getStatus).toHaveBeenCalledWith("Test-01", signal);
		expect(result).toEqual({ airportId: "Test-01", online: true });
	});

	it("getDroneStatus delegates to platform.drone.getStatus and passes the signal", async () => {
		const platform = createPlatformClient();
		const client = new HttpUavCapabilityClient(platform);
		const signal = new AbortController().signal;
		const result = await client.getDroneStatus({ droneSn: "SN" }, signal);
		expect(platform.drone.getStatus).toHaveBeenCalledWith("SN", signal);
		expect(result).toEqual({ droneSn: "SN", online: true });
	});

	it("getMissionStatus delegates to platform.mission.getStatus and passes the signal", async () => {
		const platform = createPlatformClient();
		const client = new HttpUavCapabilityClient(platform);
		const signal = new AbortController().signal;
		const result = await client.getMissionStatus({ missionId: "M" }, signal);
		expect(platform.mission.getStatus).toHaveBeenCalledWith("M", signal);
		expect(result).toEqual({ missionId: "M", status: "completed" });
	});

	it("preflightCheck delegates to platform.safety.preflightCheck and passes the signal", async () => {
		const platform = createPlatformClient();
		const client = new HttpUavCapabilityClient(platform);
		const signal = new AbortController().signal;
		const result = await client.preflightCheck({ airportId: "A" }, signal);
		expect(platform.safety.preflightCheck).toHaveBeenCalledWith("A", signal);
		expect(result.passed).toBe(true);
	});

	it("propagates PlatformError unchanged (same instance, no re-wrap)", async () => {
		const error = new PlatformError({
			code: "AIRPORT_NOT_FOUND",
			message: "Airport not found: X",
			retryable: false,
		});
		const platform = createPlatformClient();
		(platform.airport.getStatus as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);
		const client = new HttpUavCapabilityClient(platform);
		await expect(client.getAirportStatus({ airportId: "X" })).rejects.toBe(error);
	});

	it("returns the platform result object untouched", async () => {
		const payload: PreflightResult = {
			airportId: "A",
			passed: false,
			checks: [{ name: "airport_online", passed: false, detail: "offline" }],
		};
		const platform = createPlatformClient();
		(platform.safety.preflightCheck as ReturnType<typeof vi.fn>).mockResolvedValueOnce(payload);
		const client = new HttpUavCapabilityClient(platform);
		const result = await client.preflightCheck({ airportId: "A" });
		expect(result).toBe(payload);
	});
});
