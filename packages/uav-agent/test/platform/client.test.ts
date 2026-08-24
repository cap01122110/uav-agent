import { describe, expect, it, vi } from "vitest";
import { HttpPlatformClient } from "../../src/platform/client.ts";
import { PlatformError } from "../../src/platform/errors.ts";
import type { HttpTransport, TransportRequestOptions } from "../../src/platform/transport.ts";

class MockTransport implements HttpTransport {
	calls: TransportRequestOptions[] = [];
	responses: Array<{ status: number; body: unknown }> = [];

	async request<T>(options: TransportRequestOptions): Promise<T> {
		this.calls.push(options);
		const response = this.responses.shift();
		if (response === undefined) {
			throw new Error("No mock response queued");
		}
		if (response.status >= 400) {
			throw new PlatformError(
				{ code: "PLATFORM_UNAVAILABLE", message: `HTTP ${response.status}`, retryable: false },
				{ status: response.status },
			);
		}
		return response.body as T;
	}
}

function envelope(data: unknown): unknown {
	return { code: 0, message: "success", data };
}

function createClient(transport: MockTransport, token = "tok-1"): HttpPlatformClient {
	return new HttpPlatformClient({
		baseUrl: "https://platform/",
		tokenProvider: { getToken: async () => token },
		transport,
		workspaceId: "ws-1",
	});
}

describe("HttpPlatformClient", () => {
	it("resolves a nickname via dock list when the direct SN lookup misses", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 404, body: undefined });
		transport.responses.push({
			status: 200,
			body: envelope({
				list: [
					{ deviceSn: "8UUXN7N00A0G5T", deviceType: 3, deviceName: "DJI DOCK 3" },
					{ deviceSn: "7CACN870010SVT", deviceType: 174, deviceName: "DJI RC PLUS 2" },
				],
				pagination: { page: 1, page_size: 2, total: 2 },
			}),
		});
		transport.responses.push({
			status: 200,
			body: envelope({
				device_sn: "8UUXN7N00A0G5T",
				device_name: "DJI DOCK 3",
				nickname: "Test-01",
				status: true,
				osd_online_status: true,
				bound_status: true,
				login_time: "2026-08-21 09:48:54",
			}),
		});
		// Second dock detail fails; must not break the nickname lookup.
		transport.responses.push({ status: 404, body: undefined });
		const client = createClient(transport);

		const status = await client.airport.getStatus("Test-01");
		expect(status.airportId).toBe("Test-01");
		expect(status.name).toBe("Test-01");
		expect(status.online).toBe(true);
		expect(status.droneBinded).toBe(true);
		expect(status.lastSeenAt).toBe(Date.parse("2026-08-21T09:48:54"));

		expect(transport.calls.length).toBeGreaterThanOrEqual(3);
		const listCall = transport.calls[1];
		expect(listCall.method).toBe("POST");
		expect(listCall.url).toBe("https://platform/manage/api/v1/workspaces/ws-1/devices/getDockListPageVo");
		expect(listCall.headers?.["x-auth-token"]).toBe("tok-1");
		expect(listCall.body).toEqual({ page_num: 1, page_size: 100, workspace_id: "ws-1" });
		expect(transport.calls.some((c) => c.url.endsWith("/devices/8UUXN7N00A0G5T"))).toBe(true);
	});

	it("matches airports by device SN with a direct detail lookup", async () => {
		const transport = new MockTransport();
		transport.responses.push({
			status: 200,
			body: envelope({ device_sn: "8UUXN7N00A0G5T", type: 3, nickname: "Test-01" }),
		});
		const client = createClient(transport);
		const status = await client.airport.getStatus("8UUXN7N00A0G5T");
		expect(status.airportId).toBe("8UUXN7N00A0G5T");
		expect(transport.calls).toHaveLength(1);
		expect(transport.calls[0]?.url).toBe("https://platform/manage/api/v1/workspaces/ws-1/devices/8UUXN7N00A0G5T");
	});

	it("resolve returns the canonical device SN", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 404, body: undefined });
		transport.responses.push({ status: 200, body: envelope({ list: [{ deviceSn: "DOCK1", deviceType: 3 }] }) });
		transport.responses.push({
			status: 200,
			body: envelope({ device_sn: "DOCK1", nickname: "Test-01", status: true }),
		});
		const client = createClient(transport);
		const resolved = await client.airport.resolve("Test-01");
		expect(resolved.deviceSn).toBe("DOCK1");
		expect(resolved.name).toBe("Test-01");
		expect(resolved.online).toBe(true);
	});

	it("returns AIRPORT_NOT_FOUND when no dock matches", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 404, body: undefined });
		transport.responses.push({
			status: 200,
			body: envelope({ list: [{ deviceSn: "8UUXN7N00A0G5T", deviceType: 3 }] }),
		});
		transport.responses.push({ status: 200, body: envelope({ device_sn: "8UUXN7N00A0G5T", nickname: "Other" }) });
		const client = createClient(transport);
		try {
			await client.airport.getStatus("missing");
			expect.unreachable();
		} catch (error) {
			expect((error as PlatformError).code).toBe("AIRPORT_NOT_FOUND");
		}
	});

	it("returns AIRPORT_NOT_FOUND when the workspace has no docks", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 404, body: undefined });
		transport.responses.push({ status: 200, body: envelope({ list: [], pagination: null }) });
		const client = createClient(transport);
		try {
			await client.airport.getStatus("Test-01");
			expect.unreachable();
		} catch (error) {
			expect((error as PlatformError).code).toBe("AIRPORT_NOT_FOUND");
		}
	});

	it("maps HTTP 404 to DRONE_NOT_FOUND for drone calls", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 404, body: undefined });
		const client = createClient(transport);
		try {
			await client.drone.getStatus("SN-missing");
			expect.unreachable();
		} catch (error) {
			expect((error as PlatformError).code).toBe("DRONE_NOT_FOUND");
		}
	});

	it("maps HTTP 404 to MISSION_NOT_FOUND for mission calls", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 404, body: undefined });
		const client = createClient(transport);
		try {
			await client.mission.getStatus("M-missing");
			expect.unreachable();
		} catch (error) {
			expect((error as PlatformError).code).toBe("MISSION_NOT_FOUND");
		}
	});

	it("maps non-zero business codes to UNKNOWN_ERROR with the platform message", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 200, body: { code: 50012, message: "设备不存在" } });
		const client = createClient(transport);
		try {
			await client.drone.getStatus("nope");
			expect.unreachable();
		} catch (error) {
			expect((error as PlatformError).code).toBe("UNKNOWN_ERROR");
			expect((error as PlatformError).message).toContain("设备不存在");
		}
	});

	it("getDroneStatus parses device detail", async () => {
		const transport = new MockTransport();
		transport.responses.push({
			status: 200,
			body: envelope({ device_sn: "SN-1", type: 100, status: true, gps: { latitude: 1, longitude: 2 } }),
		});
		const client = createClient(transport);
		const status = await client.drone.getStatus("SN-1");
		expect(status.online).toBe(true);
		expect(status.gps?.longitude).toBe(2);
	});

	it("getMissionStatus matches a job by id", async () => {
		const transport = new MockTransport();
		transport.responses.push({
			status: 200,
			body: envelope({ list: [{ job_id: "J1", status: 3, begin_time: 1_700_000_000 }] }),
		});
		const client = createClient(transport);
		const status = await client.mission.getStatus("J1");
		expect(status.status).toBe("completed");
		expect(status.startedAt).toBe(1_700_000_000_000);
	});

	it("preflightCheck passes when airport is online, idle and drone is bound", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 404, body: undefined });
		transport.responses.push({ status: 200, body: envelope({ list: [{ deviceSn: "DOCK1", deviceType: 3 }] }) });
		transport.responses.push({
			status: 200,
			body: envelope({
				device_sn: "DOCK1",
				nickname: "Test-01",
				status: true,
				mode_code: 0,
				child_device_sn: "DRONE1",
			}),
		});
		transport.responses.push({
			status: 200,
			body: envelope({ list: [{ deviceSn: "DOCK1", deviceType: 3, modeCode: 0 }] }),
		});
		transport.responses.push({ status: 200, body: envelope({ list: [], pagination: null }) });
		transport.responses.push({
			status: 200,
			body: envelope({ device_sn: "DRONE1", status: true, device_name: "Matrice 4TD" }),
		});
		const client = createClient(transport);
		const result = await client.safety.preflightCheck("Test-01");
		expect(result.passed).toBe(true);
		expect(result.checks).toHaveLength(4);
	});

	it("docked drone offline does not alone fail the preflight check", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 404, body: undefined });
		transport.responses.push({ status: 200, body: envelope({ list: [{ deviceSn: "DOCK1", deviceType: 3 }] }) });
		transport.responses.push({
			status: 200,
			body: envelope({
				device_sn: "DOCK1",
				nickname: "Test-01",
				status: true,
				mode_code: 0,
				child_device_sn: "DRONE1",
			}),
		});
		transport.responses.push({
			status: 200,
			body: envelope({ list: [{ deviceSn: "DOCK1", deviceType: 3, modeCode: 0 }] }),
		});
		transport.responses.push({ status: 200, body: envelope({ list: [], pagination: null }) });
		transport.responses.push({ status: 200, body: envelope({ device_sn: "DRONE1", status: false }) });
		const client = createClient(transport);
		const result = await client.safety.preflightCheck("Test-01");
		expect(result.passed).toBe(true);
		const droneCheck = result.checks.find((check) => check.name === "drone_online");
		expect(droneCheck?.passed).toBe(false);
		expect(droneCheck?.informational).toBe(true);
	});

	it("preflightCheck rejects an airport with an active (running) job", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 404, body: undefined });
		transport.responses.push({ status: 200, body: envelope({ list: [{ deviceSn: "DOCK1", deviceType: 3 }] }) });
		transport.responses.push({
			status: 200,
			body: envelope({
				device_sn: "DOCK1",
				nickname: "Test-01",
				status: true,
				mode_code: 0,
				child_device_sn: "DRONE1",
			}),
		});
		transport.responses.push({
			status: 200,
			body: envelope({ list: [{ deviceSn: "DOCK1", deviceType: 3, modeCode: 0 }] }),
		});
		transport.responses.push({ status: 200, body: envelope({ list: [{ job_id: "J1", status: 1 }] }) });
		transport.responses.push({ status: 200, body: envelope({ device_sn: "DRONE1", status: true }) });
		const client = createClient(transport);
		const result = await client.safety.preflightCheck("Test-01");
		expect(result.passed).toBe(false);
		const idleCheck = result.checks.find((check) => check.name === "airport_idle");
		expect(idleCheck?.passed).toBe(false);
	});

	it("preflightCheck fails closed when the airport idle state is unknown", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 404, body: undefined });
		transport.responses.push({ status: 200, body: envelope({ list: [{ deviceSn: "DOCK1", deviceType: 3 }] }) });
		transport.responses.push({
			status: 200,
			body: envelope({
				device_sn: "DOCK1",
				nickname: "Test-01",
				status: true,
				mode_code: -1,
				child_device_sn: "DRONE1",
			}),
		});
		transport.responses.push({
			status: 200,
			body: envelope({ list: [{ deviceSn: "DOCK1", deviceType: 3, modeCode: -1 }] }),
		});
		transport.responses.push({ status: 200, body: envelope({ list: [], pagination: null }) });
		transport.responses.push({ status: 200, body: envelope({ device_sn: "DRONE1", status: true }) });
		const client = createClient(transport);
		const result = await client.safety.preflightCheck("Test-01");
		expect(result.passed).toBe(false);
		const idleCheck = result.checks.find((check) => check.name === "airport_idle");
		expect(idleCheck?.passed).toBe(false);
	});

	it("propagates abort signals to the transport", async () => {
		const transport = new MockTransport();
		transport.responses.push({
			status: 200,
			body: envelope({ device_sn: "A", type: 3 }),
		});
		const client = createClient(transport);
		const controller = new AbortController();
		await client.airport.getStatus("A", controller.signal);
		expect(transport.calls[0]?.signal).toBe(controller.signal);
	});

	it("passes an abort signal to the token provider", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 200, body: envelope({ device_sn: "A", type: 3 }) });
		const getToken = vi.fn(async () => "tok");
		const client = new HttpPlatformClient({
			baseUrl: "https://platform",
			tokenProvider: { getToken },
			transport,
			workspaceId: "ws-1",
		});
		const controller = new AbortController();
		await client.airport.getStatus("A", controller.signal);
		expect(getToken).toHaveBeenCalledWith(controller.signal);
	});

	it("throws INVALID_REQUEST when no workspace can be resolved", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 200, body: envelope({ list: [], pagination: null }) });
		transport.responses.push({ status: 200, body: envelope({ list: [], pagination: null }) });
		const client = new HttpPlatformClient({
			baseUrl: "https://platform",
			tokenProvider: { getToken: async () => "tok" },
			transport,
		});
		try {
			await client.airport.getStatus("A");
			expect.unreachable();
		} catch (error) {
			expect((error as PlatformError).code).toBe("INVALID_REQUEST");
		}
	});

	it("resolves the workspace from the workspace list when not configured", async () => {
		const transport = new MockTransport();
		transport.responses.push({
			status: 200,
			body: envelope({
				list: [
					{ workspace_id: "ws-2", workspace_name: "B", joined: false, capabilities: { can_enter: false } },
					{ workspace_id: "ws-1", workspace_name: "A", joined: true, capabilities: { can_enter: true } },
				],
			}),
		});
		transport.responses.push({ status: 404, body: undefined });
		transport.responses.push({ status: 200, body: envelope({ list: [{ deviceSn: "A", deviceType: 3 }] }) });
		transport.responses.push({ status: 200, body: envelope({ device_sn: "A", nickname: "A" }) });
		const client = new HttpPlatformClient({
			baseUrl: "https://platform",
			tokenProvider: { getToken: async () => "tok" },
			transport,
		});
		const status = await client.airport.getStatus("A");
		expect(status.airportId).toBe("A");
		expect(transport.calls[2]?.url).toContain("/workspaces/ws-1/devices/getDockListPageVo");
	});
});
