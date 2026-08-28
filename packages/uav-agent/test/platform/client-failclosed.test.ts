/**
 * Fail-closed regression tests for the read-only platform path.
 *
 * Pins the safety contract: an unknown must never parse as a safe answer.
 * - the job scan reads every page, so a running/paused job on a later page
 *   still blocks the preflight check;
 * - any failed page, malformed payload or inconsistent pagination throws
 *   (INVALID_RESPONSE or the underlying platform error) instead of becoming
 *   "no active job" / "offline" / "not found";
 * - an explicit false still parses as offline (business semantics unchanged).
 */
import { describe, expect, it } from "vitest";
import { HttpPlatformClient } from "../../src/platform/client.ts";
import type { PlatformError } from "../../src/platform/errors.ts";
import { envelope, listPage, MockTransport } from "../helpers/mock-transport.ts";

const DOCK_DETAIL = {
	device_sn: "DOCK1",
	type: 3,
	status: true,
	mode_code: 0,
	child_device_sn: "DRONE1",
};

const DOCK_ROW = { deviceSn: "DOCK1", deviceType: 3, modeCode: 0 };

function createClient(transport: MockTransport): HttpPlatformClient {
	return new HttpPlatformClient({
		baseUrl: "https://platform/",
		tokenProvider: { getToken: async () => "tok-1" },
		transport,
		workspaceId: "ws-1",
		pageSize: 1,
	});
}

/** Queue an SN-addressed preflight flow: direct detail, dock list, job pages, drone detail. */
function queueDirectPreflight(
	transport: MockTransport,
	jobPages: Array<{ status: number; body: unknown }>,
	droneDetail: Record<string, unknown> = { device_sn: "DRONE1", status: true, device_name: "Matrice 4TD" },
	detail: Record<string, unknown> = DOCK_DETAIL,
): void {
	transport.responses.push({ status: 200, body: envelope(detail) });
	transport.responses.push({ status: 200, body: listPage([DOCK_ROW], 1, 1, 1) });
	transport.responses.push(...jobPages);
	transport.responses.push({ status: 200, body: envelope(droneDetail) });
}

function jobPage(pageNum: number, pageSize: number, total: number, jobs: unknown[]): { status: number; body: unknown } {
	return { status: 200, body: listPage(jobs, pageNum, pageSize, total) };
}

async function expectPlatformError(run: () => Promise<unknown>, code: PlatformError["code"]): Promise<PlatformError> {
	try {
		await run();
	} catch (error) {
		expect((error as PlatformError).code).toBe(code);
		return error as PlatformError;
	}
	expect.unreachable();
}

describe("airportHasActiveJob scans every page (via preflightCheck)", () => {
	it("blocks when the running job is on page 1, and stops scanning once found", async () => {
		const transport = new MockTransport();
		queueDirectPreflight(transport, [jobPage(1, 1, 1, [{ job_id: "J1", status: 1 }])]);
		const result = await createClient(transport).safety.preflightCheck("DOCK1");
		expect(result.passed).toBe(false);
		const idle = result.checks.find((check) => check.name === "airport_idle");
		expect(idle?.passed).toBe(false);
		expect(idle?.detail).toContain("忙碌");
		const jobCalls = transport.calls.filter((call) => call.url.includes("getJobListPageVo"));
		expect(jobCalls).toHaveLength(1);
	});

	it("blocks when a running job is only on page 2", async () => {
		const transport = new MockTransport();
		queueDirectPreflight(transport, [
			jobPage(1, 1, 2, [{ job_id: "J0", status: 3 }]),
			jobPage(2, 1, 2, [{ job_id: "J1", status: 1 }]),
		]);
		const result = await createClient(transport).safety.preflightCheck("DOCK1");
		expect(result.passed).toBe(false);
		const idle = result.checks.find((check) => check.name === "airport_idle");
		expect(idle?.passed).toBe(false);
	});

	it("blocks when a paused job is only on page 2", async () => {
		const transport = new MockTransport();
		queueDirectPreflight(transport, [
			jobPage(1, 1, 2, [{ job_id: "J0", status: 3 }]),
			jobPage(2, 1, 2, [{ job_id: "J1", status: 6 }]),
		]);
		const result = await createClient(transport).safety.preflightCheck("DOCK1");
		expect(result.passed).toBe(false);
	});

	it("passes after a complete multi-page scan with no active job", async () => {
		const transport = new MockTransport();
		queueDirectPreflight(transport, [
			jobPage(1, 1, 2, [{ job_id: "J0", status: 3 }]),
			jobPage(2, 1, 2, [{ job_id: "J1", status: 2 }]),
		]);
		const result = await createClient(transport).safety.preflightCheck("DOCK1");
		expect(result.passed).toBe(true);
		const idle = result.checks.find((check) => check.name === "airport_idle");
		expect(idle?.passed).toBe(true);
	});

	it("fails closed when a later page request fails (HTTP 500)", async () => {
		const transport = new MockTransport();
		queueDirectPreflight(transport, [
			jobPage(1, 1, 2, [{ job_id: "J0", status: 3 }]),
			{ status: 500, body: undefined },
		]);
		await expectPlatformError(() => createClient(transport).safety.preflightCheck("DOCK1"), "PLATFORM_UNAVAILABLE");
	});

	it("fails closed when a later page omits pagination", async () => {
		const transport = new MockTransport();
		queueDirectPreflight(transport, [
			jobPage(1, 1, 2, [{ job_id: "J0", status: 3 }]),
			{ status: 200, body: envelope({ list: [{ job_id: "J1", status: 1 }] }) },
		]);
		await expectPlatformError(() => createClient(transport).safety.preflightCheck("DOCK1"), "INVALID_RESPONSE");
	});

	it("fails closed when pagination is missing or illegal", async () => {
		for (const body of [
			envelope({ list: [] }),
			envelope({ list: [], pagination: null }),
			envelope({ list: [], pagination: { page: 1, page_size: 0, total: 0 } }),
			envelope({ list: [], pagination: { page: 3, page_size: 100, total: 0 } }),
		]) {
			const transport = new MockTransport();
			queueDirectPreflight(transport, [{ status: 200, body }]);
			await expectPlatformError(() => createClient(transport).safety.preflightCheck("DOCK1"), "INVALID_RESPONSE");
		}
	});

	it("fails closed when total contradicts the items read", async () => {
		const transport = new MockTransport();
		queueDirectPreflight(transport, [
			{
				status: 200,
				body: envelope({ list: [{ job_id: "J0", status: 3 }], pagination: { page: 1, page_size: 100, total: 2 } }),
			},
		]);
		await expectPlatformError(() => createClient(transport).safety.preflightCheck("DOCK1"), "INVALID_RESPONSE");
	});

	it("fails closed when a job record has no readable status", async () => {
		const transport = new MockTransport();
		queueDirectPreflight(transport, [jobPage(1, 1, 1, [{ job_id: "J0" }])]);
		await expectPlatformError(() => createClient(transport).safety.preflightCheck("DOCK1"), "INVALID_RESPONSE");
	});

	it("fails closed when a later page changes page_size", async () => {
		const transport = new MockTransport();
		queueDirectPreflight(transport, [
			{ status: 200, body: listPage([{ job_id: "J0", status: 3 }], 1, 1, 2) },
			{ status: 200, body: listPage([], 2, 2, 2) }, // server changed span mid-scan
		]);
		await expectPlatformError(() => createClient(transport).safety.preflightCheck("DOCK1"), "INVALID_RESPONSE");
	});

	it("fails closed when a later page changes total (up or down)", async () => {
		for (const tail of [
			{ status: 200, body: listPage([], 2, 1, 149) },
			{ status: 200, body: listPage([{ job_id: "J1", status: 1 }], 2, 1, 200) },
		]) {
			const transport = new MockTransport();
			queueDirectPreflight(transport, [
				{ status: 200, body: listPage([{ job_id: "J0", status: 3 }], 1, 1, 150) },
				tail,
			]);
			await expectPlatformError(() => createClient(transport).safety.preflightCheck("DOCK1"), "INVALID_RESPONSE");
		}
	});
});

describe("job status strictness (unknown is never inactive)", () => {
	it("treats known running (1) and paused (6) as active and blocks the check", async () => {
		for (const status of [1, 6]) {
			const transport = new MockTransport();
			queueDirectPreflight(transport, [jobPage(1, 1, 1, [{ job_id: "J1", status }])]);
			const result = await createClient(transport).safety.preflightCheck("DOCK1");
			expect(result.passed).toBe(false);
		}
	});

	it("treats known non-active statuses (0, 2, 3, 4, 5) as inactive and passes", async () => {
		for (const status of [0, 2, 3, 4, 5]) {
			const transport = new MockTransport();
			queueDirectPreflight(transport, [jobPage(1, 1, 1, [{ job_id: "J1", status }])]);
			const result = await createClient(transport).safety.preflightCheck("DOCK1");
			expect(result.passed).toBe(true);
		}
	});

	it("throws INVALID_RESPONSE for an unknown integer status", async () => {
		for (const status of [7, 99, 1.5]) {
			const transport = new MockTransport();
			queueDirectPreflight(transport, [jobPage(1, 1, 1, [{ job_id: "J1", status }])]);
			await expectPlatformError(() => createClient(transport).safety.preflightCheck("DOCK1"), "INVALID_RESPONSE");
		}
	});

	it("accepts a numeric string status the same as a number (wire contract)", async () => {
		const transport = new MockTransport();
		queueDirectPreflight(transport, [jobPage(1, 1, 1, [{ job_id: "J1", status: "6" }])]);
		const result = await createClient(transport).safety.preflightCheck("DOCK1");
		expect(result.passed).toBe(false);
	});
});

describe("strict envelope validation", () => {
	it("rejects code=0 with missing data for the device detail endpoint", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 200, body: { code: 0, message: "success" } });
		await expectPlatformError(() => createClient(transport).drone.getStatus("SN-1"), "INVALID_RESPONSE");
	});

	it("rejects code=0 with data=null when the endpoint requires a record", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 200, body: { code: 0, message: "success", data: null } });
		await expectPlatformError(() => createClient(transport).drone.getStatus("SN-1"), "INVALID_RESPONSE");
	});

	it("rejects a non-object envelope and a missing code", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 200, body: {} });
		await expectPlatformError(() => createClient(transport).drone.getStatus("SN-1"), "INVALID_RESPONSE");
	});
});

describe("missing online state is invalid, never offline", () => {
	it("drone status without an online field throws INVALID_RESPONSE", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 200, body: envelope({ device_sn: "DRONE1", type: 100 }) });
		await expectPlatformError(() => createClient(transport).drone.getStatus("DRONE1"), "INVALID_RESPONSE");
	});

	it("airport status without an online field throws INVALID_RESPONSE", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 200, body: envelope({ device_sn: "DOCK1", type: 3, mode_code: 0 }) });
		await expectPlatformError(() => createClient(transport).airport.getStatus("DOCK1"), "INVALID_RESPONSE");
	});

	it("an explicit online=false still parses as offline (business semantics kept)", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 200, body: envelope({ device_sn: "DOCK1", type: 3, status: false }) });
		const status = await createClient(transport).airport.getStatus("DOCK1");
		expect(status.online).toBe(false);
	});

	it("preflight reports an unknown airport online state as a failed check, not offline", async () => {
		const transport = new MockTransport();
		queueDirectPreflight(
			transport,
			[jobPage(1, 1, 0, [])],
			{ device_sn: "DRONE1", status: true },
			{ ...DOCK_DETAIL, status: undefined },
		);
		const result = await createClient(transport).safety.preflightCheck("DOCK1");
		expect(result.passed).toBe(false);
		const online = result.checks.find((check) => check.name === "airport_online");
		expect(online?.passed).toBe(false);
		expect(online?.detail).toContain("未知");
	});

	it("an unknown drone online state stays informational", async () => {
		const transport = new MockTransport();
		queueDirectPreflight(transport, [jobPage(1, 1, 0, [])], { device_sn: "DRONE1", device_name: "Matrice 4TD" });
		const result = await createClient(transport).safety.preflightCheck("DOCK1");
		expect(result.passed).toBe(true);
		const drone = result.checks.find((check) => check.name === "drone_online");
		expect(drone?.passed).toBe(false);
		expect(drone?.informational).toBe(true);
		expect(drone?.detail).toContain("未知");
	});
});

describe("invalid payloads never become NOT_FOUND", () => {
	it("an illegal job list payload throws INVALID_RESPONSE, not MISSION_NOT_FOUND", async () => {
		for (const body of [envelope({}), envelope({ list: {} }), { code: 0, message: "success", data: null }]) {
			const transport = new MockTransport();
			transport.responses.push({ status: 200, body });
			await expectPlatformError(() => createClient(transport).mission.getStatus("J1"), "INVALID_RESPONSE");
		}
	});

	it("MISSION_NOT_FOUND still applies after a complete, trusted scan", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 200, body: listPage([], 1, 1, 0) });
		await expectPlatformError(() => createClient(transport).mission.getStatus("J1"), "MISSION_NOT_FOUND");
	});

	it("an illegal dock list payload throws INVALID_RESPONSE, not AIRPORT_NOT_FOUND", async () => {
		for (const body of [
			envelope({ list: [], pagination: null }),
			envelope({}),
			envelope({ list: [{}], pagination: { page: 1, page_size: 1, total: 1 } }),
		]) {
			const transport = new MockTransport();
			transport.responses.push({ status: 404, body: undefined });
			transport.responses.push({ status: 200, body });
			await expectPlatformError(() => createClient(transport).airport.getStatus("Test-01"), "INVALID_RESPONSE");
		}
	});

	it("a failing dock detail during name resolution fails closed instead of AIRPORT_NOT_FOUND", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 404, body: undefined });
		transport.responses.push({ status: 200, body: listPage([{ deviceSn: "OTHER", deviceType: 3 }], 1, 1, 1) });
		transport.responses.push({ status: 500, body: undefined });
		await expectPlatformError(() => createClient(transport).airport.getStatus("Test-01"), "PLATFORM_UNAVAILABLE");
	});

	it("a missing device_sn on the detail payload fails the preflight closed", async () => {
		const transport = new MockTransport();
		queueDirectPreflight(
			transport,
			[jobPage(1, 1, 0, [])],
			{ device_sn: "DRONE1", status: true },
			{
				type: 3,
				status: true,
				mode_code: 0,
			},
		);
		await expectPlatformError(() => createClient(transport).safety.preflightCheck("DOCK1"), "INVALID_RESPONSE");
	});
});

describe("direct airport resolution error classification", () => {
	it("404 falls back to the dock list and nickname resolution can succeed", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 404, body: undefined });
		transport.responses.push({ status: 200, body: listPage([{ deviceSn: "DOCK1", deviceType: 3 }], 1, 1, 1) });
		transport.responses.push({
			status: 200,
			body: envelope({ device_sn: "DOCK1", nickname: "Test-01", status: true }),
		});
		const status = await createClient(transport).airport.getStatus("Test-01");
		expect(status.name).toBe("Test-01");
	});

	it("PERMISSION_DENIED propagates and the dock list is never called", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 403, body: undefined });
		const client = createClient(transport);
		await expectPlatformError(() => client.airport.getStatus("Test-01"), "PERMISSION_DENIED");
		expect(transport.calls.some((call) => call.url.includes("getDockListPageVo"))).toBe(false);
	});

	it("UPSTREAM_TIMEOUT propagates without fallback", async () => {
		const transport = new MockTransport();
		transport.responses.push({
			status: 504,
			body: undefined,
		});
		const client = createClient(transport);
		await expectPlatformError(() => client.airport.getStatus("Test-01"), "UPSTREAM_TIMEOUT");
		expect(transport.calls.some((call) => call.url.includes("getDockListPageVo"))).toBe(false);
	});

	it("PLATFORM_UNAVAILABLE propagates without fallback", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 503, body: undefined });
		const client = createClient(transport);
		await expectPlatformError(() => client.airport.getStatus("Test-01"), "PLATFORM_UNAVAILABLE");
		expect(transport.calls.some((call) => call.url.includes("getDockListPageVo"))).toBe(false);
	});

	it("an invalid response propagates without fallback", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 200, body: { code: 0, message: "success", data: null } });
		const client = createClient(transport);
		await expectPlatformError(() => client.airport.getStatus("Test-01"), "INVALID_RESPONSE");
		expect(transport.calls.some((call) => call.url.includes("getDockListPageVo"))).toBe(false);
	});

	it("caller abort propagates as AbortError without fallback", async () => {
		// A transport that aborts the direct request must surface AbortError to
		// the caller; tryDirectAirportDetail must not convert it to NOT_FOUND.
		const calls: string[] = [];
		const abortingTransport = {
			async request(options: { url: string }): Promise<never> {
				calls.push(options.url);
				throw new DOMException("The operation was aborted", "AbortError");
			},
		};
		const client = new HttpPlatformClient({
			baseUrl: "https://platform/",
			tokenProvider: { getToken: async () => "tok-1" },
			transport: abortingTransport,
			workspaceId: "ws-1",
			pageSize: 1,
		});
		try {
			await client.airport.getStatus("Test-01");
			expect.unreachable();
		} catch (error) {
			expect((error as DOMException).name).toBe("AbortError");
		}
		expect(calls.some((url) => url.includes("getDockListPageVo"))).toBe(false);
	});

	it("a direct hit on a non-dock device falls back to the name scan", async () => {
		const transport = new MockTransport();
		transport.responses.push({ status: 200, body: envelope({ device_sn: "SN", type: 100, status: true }) });
		transport.responses.push({ status: 200, body: listPage([{ deviceSn: "DOCK1", deviceType: 3 }], 1, 1, 1) });
		transport.responses.push({
			status: 200,
			body: envelope({ device_sn: "DOCK1", nickname: "Test-01", status: true }),
		});
		const status = await createClient(transport).airport.getStatus("Test-01");
		expect(status.name).toBe("Test-01");
	});
});

describe("business envelope never leaks upstream text", () => {
	it("a non-zero business code with a sensitive message maps to a stable message", async () => {
		const transport = new MockTransport();
		transport.responses.push({
			status: 200,
			body: { code: 50012, message: "SQL failed password=secret token=abc" },
		});
		const client = createClient(transport);
		try {
			await client.drone.getStatus("nope");
			expect.unreachable();
		} catch (error) {
			const err = error as PlatformError;
			expect(err.code).toBe("UNKNOWN_ERROR");
			expect(err.message).toBe("UAV platform request failed.");
			expect(err.message).not.toContain("SQL");
			expect(err.message).not.toContain("password");
			expect(err.message).not.toContain("secret");
			expect(err.message).not.toContain("token");
		}
	});
});
