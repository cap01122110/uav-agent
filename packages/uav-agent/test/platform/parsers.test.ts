import { describe, expect, it } from "vitest";
import {
	parseAirportStatus,
	parseDroneStatus,
	parseMissionStatus,
	parsePreflightResult,
} from "../../src/platform/parsers.ts";

describe("parseAirportStatus", () => {
	it("parses a getDevice detail payload", () => {
		const status = parseAirportStatus(
			{
				device_sn: "8UUXN7N00A0G5T",
				device_name: "DJI DOCK 3",
				nickname: "Test-01",
				status: true,
				bound_status: true,
			},
			"Test-01",
		);
		expect(status.airportId).toBe("Test-01");
		expect(status.online).toBe(true);
		expect(status.name).toBe("Test-01");
		expect(status.droneBinded).toBe(true);
	});

	it("parses login_time into epoch ms", () => {
		const status = parseAirportStatus({ login_time: "2026-08-21 09:48:54" }, "A");
		expect(status.lastSeenAt).toBe(Date.parse("2026-08-21T09:48:54"));
	});

	it("maps string status values and aliases", () => {
		expect(parseAirportStatus({ online_status: "online", battery_percent: "90" }, "A").battery).toBe(90);
		expect(parseAirportStatus({ online_status: "offline" }, "A").online).toBe(false);
	});

	it("defaults missing state to offline", () => {
		expect(parseAirportStatus({}, "A").online).toBe(false);
	});
});

describe("parseDroneStatus", () => {
	it("parses gps and flying state", () => {
		const status = parseDroneStatus(
			{ online: true, flying: true, gps: { latitude: 22.5, longitude: 114.1, altitude: 120 } },
			"SN-1",
		);
		expect(status.droneSn).toBe("SN-1");
		expect(status.flying).toBe(true);
		expect(status.gps?.latitude).toBe(22.5);
		expect(status.gps?.altitude).toBe(120);
	});

	it("does not fabricate coordinates when one axis is missing", () => {
		expect(parseDroneStatus({ gps: { latitude: 22.82 } }, "SN").gps).toBeUndefined();
		expect(parseDroneStatus({ gps: { longitude: 108.32 } }, "SN").gps).toBeUndefined();
	});

	it("rejects out-of-range coordinates", () => {
		expect(parseDroneStatus({ gps: { latitude: 120, longitude: 108.32 } }, "SN").gps).toBeUndefined();
		expect(parseDroneStatus({ gps: { latitude: 22.82, longitude: 190 } }, "SN").gps).toBeUndefined();
		expect(parseDroneStatus({ gps: { latitude: -95, longitude: 0 } }, "SN").gps).toBeUndefined();
	});

	it("maps flightStatus alias", () => {
		expect(parseDroneStatus({ flightStatus: "flying" }, "SN").flying).toBe(true);
		expect(parseDroneStatus({ flightStatus: "landed" }, "SN").flying).toBe(false);
	});
});

describe("parseMissionStatus", () => {
	it("normalizes status values", () => {
		expect(parseMissionStatus({ status: "in_progress" }, "M1").status).toBe("running");
		expect(parseMissionStatus({ status: "finished" }, "M1").status).toBe("completed");
		expect(parseMissionStatus({ status: "canceled" }, "M1").status).toBe("cancelled");
		expect(parseMissionStatus({ status: "weird" }, "M1").status).toBe("unknown");
	});

	it("maps numeric wayline job status (DJI enum)", () => {
		expect(parseMissionStatus({ status: 0 }, "M1").status).toBe("pending");
		expect(parseMissionStatus({ status: 1 }, "M1").status).toBe("running");
		expect(parseMissionStatus({ status: 2 }, "M1").status).toBe("cancelled");
		expect(parseMissionStatus({ status: 3 }, "M1").status).toBe("completed");
		expect(parseMissionStatus({ status: 4 }, "M1").status).toBe("failed");
		expect(parseMissionStatus({ status: 6 }, "M1").status).toBe("paused");
	});

	it("parses snake_case job timestamps", () => {
		const status = parseMissionStatus({ status: 3, begin_time: 1_700_000_000, completed_time: 1_700_000_500 }, "M1");
		expect(status.startedAt).toBe(1_700_000_000_000);
		expect(status.finishedAt).toBe(1_700_000_500_000);
	});
});

describe("parsePreflightResult", () => {
	it("parses checks and passes when all checks pass", () => {
		const result = parsePreflightResult(
			{
				checks: [
					{ name: "battery", passed: true },
					{ name: "gps", passed: true },
				],
			},
			"A",
		);
		expect(result.passed).toBe(true);
		expect(result.checks).toHaveLength(2);
	});

	it("fails when any check fails", () => {
		const result = parsePreflightResult(
			{
				checks: [
					{ name: "battery", passed: true },
					{ name: "gps", passed: false, detail: "no fix" },
				],
			},
			"A",
		);
		expect(result.passed).toBe(false);
		expect(result.checks[1]?.detail).toBe("no fix");
	});

	it("honors an explicit passed flag", () => {
		expect(parsePreflightResult({ passed: true, checks: [] }, "A").passed).toBe(true);
	});

	it("fails closed on an empty preflight payload", () => {
		expect(parsePreflightResult({}, "A").passed).toBe(false);
		expect(parsePreflightResult({ checks: [] }, "A").passed).toBe(false);
	});

	it("does not fail open when a check lacks a pass marker", () => {
		const result = parsePreflightResult({ checks: [{ name: "battery" }] }, "A");
		expect(result.passed).toBe(false);
	});
});
