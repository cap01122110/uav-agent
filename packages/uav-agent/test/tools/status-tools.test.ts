import { describe, expect, it } from "vitest";
import { getDroneStatusTool } from "../../src/tools/drone/get-drone-status.ts";
import { getMissionStatusTool } from "../../src/tools/mission/get-mission-status.ts";
import { preflightCheckTool } from "../../src/tools/safety/preflight-check.ts";
import { createFakeCapability } from "../helpers/fake-capability.ts";
import { fakeExtensionContext, firstText } from "../helpers/tools.ts";

describe("UAV tool schemas", () => {
	it("get_drone_status requires droneSn and calls the capability", async () => {
		const capabilities = createFakeCapability();
		const tool = getDroneStatusTool(capabilities);
		const result = await tool.execute("c1", { droneSn: "SN" }, undefined, undefined, fakeExtensionContext());
		expect(capabilities.getDroneStatus).toHaveBeenCalledWith({ droneSn: "SN" }, undefined);
		expect(JSON.parse(firstText(result))).toMatchObject({ droneSn: "SN", online: true });
	});

	it("get_mission_status requires missionId and calls the capability", async () => {
		const capabilities = createFakeCapability();
		const tool = getMissionStatusTool(capabilities);
		const result = await tool.execute("c1", { missionId: "M" }, undefined, undefined, fakeExtensionContext());
		expect(capabilities.getMissionStatus).toHaveBeenCalledWith({ missionId: "M" }, undefined);
		expect(JSON.parse(firstText(result))).toMatchObject({ missionId: "M", status: "completed" });
	});

	it("preflight_check requires airportId and calls the capability", async () => {
		const capabilities = createFakeCapability();
		const tool = preflightCheckTool(capabilities);
		const result = await tool.execute("c1", { airportId: "A" }, undefined, undefined, fakeExtensionContext());
		expect(capabilities.preflightCheck).toHaveBeenCalledWith({ airportId: "A" }, undefined);
		expect(JSON.parse(firstText(result))).toMatchObject({ passed: true });
	});

	it("all schemas declare their required field", () => {
		const schemas = [
			getDroneStatusTool(createFakeCapability()).parameters,
			getMissionStatusTool(createFakeCapability()).parameters,
			preflightCheckTool(createFakeCapability()).parameters,
		];
		for (const schema of schemas) {
			expect((schema as { required?: string[] }).required).toHaveLength(1);
		}
	});
});
