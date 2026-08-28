import { describe, expect, it, vi } from "vitest";
import type { UavAction } from "../../src/actions/types.ts";
import type { PrepareActionContext } from "../../src/tools/actions/prepare-actions.ts";
import { createUavTools } from "../../src/tools/index.ts";
import { createFakeCapability } from "../helpers/fake-capability.ts";
import { fakeExtensionContext, firstText } from "../helpers/tools.ts";

function createContext(): PrepareActionContext & { actions: UavAction[] } {
	const actions: UavAction[] = [];
	return {
		actions,
		prepareAction: vi.fn(async (_sessionId, input) => {
			const action: UavAction = {
				id: "full-uuid-action-id-1234567890abcdef",
				sessionId: _sessionId,
				type: input.type,
				summary: input.summary,
				payload: input.payload,
				status: "WAITING_CONFIRMATION",
				createdAt: 1,
				updatedAt: 1,
			};
			actions.push(action);
			return action;
		}),
	};
}

describe("tool registration defaults", () => {
	it("defaults to read-only tools without prepare actions", () => {
		const tools = createUavTools(createFakeCapability());
		const names = tools.map((tool) => tool.name);
		expect(names).toEqual(
			expect.arrayContaining([
				"get_airport_status",
				"resolve_airport",
				"get_drone_status",
				"get_mission_status",
				"preflight_check",
			]),
		);
		expect(names).not.toContain("prepare_return_home");
		expect(names).not.toContain("prepare_point_flight");
		expect(names).not.toContain("prepare_start_live");
	});

	it("adds prepare tools only when an action context is provided", () => {
		const tools = createUavTools(createFakeCapability(), createContext());
		const names = tools.map((tool) => tool.name);
		expect(names).toContain("prepare_return_home");
		expect(names).toContain("prepare_point_flight");
		expect(names).toContain("prepare_start_live");
	});
});

describe("prepare action tools", () => {
	it("prepare_return_home creates a WAITING_CONFIRMATION action with the full id", async () => {
		const context = createContext();
		const tools = createUavTools(createFakeCapability(), context);
		const tool = tools.find((t) => t.name === "prepare_return_home");
		expect(tool).toBeDefined();
		expect(tool?.executionMode).toBe("sequential");

		const result = await tool?.execute("c1", { dockSn: "DOCK1" }, undefined, undefined, fakeExtensionContext());
		expect(result).toBeDefined();
		expect(context.actions).toHaveLength(1);
		const action = context.actions[0]!;
		expect(action.status).toBe("WAITING_CONFIRMATION");
		expect(action.type).toBe("return_home");
		expect(firstText(result!)).toContain(action.id);
	});

	it("prepare_point_flight carries the target coordinates in the payload", async () => {
		const context = createContext();
		const tools = createUavTools(createFakeCapability(), context);
		const tool = tools.find((t) => t.name === "prepare_point_flight");
		await tool?.execute(
			"c1",
			{ dockSn: "DOCK1", latitude: 22.5, longitude: 114.1 },
			undefined,
			undefined,
			fakeExtensionContext(),
		);
		const action = context.actions[0]!;
		expect(action.payload).toEqual({ dockSn: "DOCK1", latitude: 22.5, longitude: 114.1, altitude: undefined });
	});

	it("prepare tools never execute flight control (only create actions)", async () => {
		const capabilities = createFakeCapability();
		const context = createContext();
		const tools = createUavTools(capabilities, context);
		const tool = tools.find((t) => t.name === "prepare_start_live");
		await tool?.execute("c1", { dockSn: "DOCK1" }, undefined, undefined, fakeExtensionContext());
		// The capability client was never touched.
		expect(capabilities.getAirportStatus).not.toHaveBeenCalled();
		expect(capabilities.getDroneStatus).not.toHaveBeenCalled();
	});
});
