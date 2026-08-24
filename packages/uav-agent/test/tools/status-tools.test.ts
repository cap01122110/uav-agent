import { describe, expect, it, vi } from "vitest";
import type { UavPlatformClient } from "../../src/platform/client.ts";
import { getDroneStatusTool } from "../../src/tools/drone/get-drone-status.ts";
import { getMissionStatusTool } from "../../src/tools/mission/get-mission-status.ts";
import { preflightCheckTool } from "../../src/tools/safety/preflight-check.ts";

function createPlatform(): UavPlatformClient {
	return {
		airport: { getStatus: vi.fn() },
		drone: { getStatus: vi.fn(async () => ({ droneSn: "SN", online: true, flying: false })) },
		mission: { getStatus: vi.fn(async () => ({ missionId: "M", status: "completed" })) },
		safety: {
			preflightCheck: vi.fn(async () => ({
				airportId: "A",
				passed: true,
				checks: [{ name: "airport_online", passed: true }],
			})),
		},
	} as unknown as UavPlatformClient;
}

describe("UAV tool schemas", () => {
	it("get_drone_status requires droneSn and calls the platform", async () => {
		const platform = createPlatform();
		const tool = getDroneStatusTool(platform);
		const result = await tool.execute("c1", { droneSn: "SN" }, undefined, undefined, undefined);
		expect(platform.drone.getStatus).toHaveBeenCalledWith("SN", undefined);
		expect(JSON.parse(result.content[0]!.text)).toMatchObject({ droneSn: "SN", online: true });
	});

	it("get_mission_status requires missionId and calls the platform", async () => {
		const platform = createPlatform();
		const tool = getMissionStatusTool(platform);
		const result = await tool.execute("c1", { missionId: "M" }, undefined, undefined, undefined);
		expect(platform.mission.getStatus).toHaveBeenCalledWith("M", undefined);
		expect(JSON.parse(result.content[0]!.text)).toMatchObject({ missionId: "M", status: "completed" });
	});

	it("preflight_check requires airportId and calls the platform", async () => {
		const platform = createPlatform();
		const tool = preflightCheckTool(platform);
		const result = await tool.execute("c1", { airportId: "A" }, undefined, undefined, undefined);
		expect(platform.safety.preflightCheck).toHaveBeenCalledWith("A", undefined);
		expect(JSON.parse(result.content[0]!.text)).toMatchObject({ passed: true });
	});

	it("all schemas declare their required field", () => {
		const schemas = [
			getDroneStatusTool(createPlatform()).parameters,
			getMissionStatusTool(createPlatform()).parameters,
			preflightCheckTool(createPlatform()).parameters,
		];
		for (const schema of schemas) {
			expect((schema as { required?: string[] }).required).toHaveLength(1);
		}
	});
});
