/**
 * Shared fake UavCapabilityClient for tool unit tests.
 *
 * Tool tests mock only the capability surface — never HTTP, pagination,
 * workspaces or the Java envelope. Override any method on the returned object
 * to script a specific result or error.
 */
import { vi } from "vitest";
import type { UavCapabilityClient } from "../../src/capability/client.ts";

export function createFakeCapability(): UavCapabilityClient {
	return {
		resolveAirport: vi.fn(async () => ({
			airportId: "Test-01",
			deviceSn: "Test-01",
			name: "Test-01",
			online: true,
		})),
		getAirportStatus: vi.fn(async () => ({
			airportId: "Test-01",
			online: true,
			battery: 90,
		})),
		getDroneStatus: vi.fn(async () => ({
			droneSn: "SN",
			online: true,
			flying: false,
		})),
		getMissionStatus: vi.fn(async () => ({
			missionId: "M",
			status: "completed",
		})),
		preflightCheck: vi.fn(async () => ({
			airportId: "A",
			passed: true,
			checks: [{ name: "airport_online", passed: true }],
		})),
	} as unknown as UavCapabilityClient;
}
