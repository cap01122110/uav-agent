import { describe, expect, it, vi } from "vitest";
import { ActionService } from "../../src/actions/action-service.ts";
import { InMemoryActionStore } from "../../src/actions/action-store.ts";
import { ActionError } from "../../src/actions/types.ts";
import type { UavAgentEvent } from "../../src/core/events.ts";

function createService(options: Parameters<typeof ActionService.prototype.constructor>[1] = {}) {
	const store = new InMemoryActionStore();
	const service = new ActionService(store, options);
	return { service, store };
}

describe("ActionService", () => {
	it("prepare creates a WAITING_CONFIRMATION action and emits confirmation_required", () => {
		const emitted: Array<{ sessionId: string; event: UavAgentEvent }> = [];
		const { service } = createService({
			onConfirmationRequired: (sessionId, event) => emitted.push({ sessionId, event }),
		});
		const action = service.prepare("s1", { type: "return_home", summary: "返航 Test-01", payload: { dockSn: "x" } });

		expect(action.status).toBe("WAITING_CONFIRMATION");
		expect(action.sessionId).toBe("s1");
		expect(emitted).toHaveLength(1);
		expect(emitted[0]?.sessionId).toBe("s1");
		expect(emitted[0]?.event).toMatchObject({
			type: "action.confirmation_required",
			actionId: action.id,
			actionType: "return_home",
			summary: "返航 Test-01",
		});
	});

	it("confirm moves the action to CONFIRMED without an executor", async () => {
		const { service, store } = createService();
		const action = service.prepare("s1", { type: "return_home", summary: "s" });
		const result = await service.confirm("s1", action.id);
		expect(result.status).toBe("CONFIRMED");
		expect(store.get(action.id)?.status).toBe("CONFIRMED");
	});

	it("confirm rejects actions owned by another session", async () => {
		const { service } = createService();
		const action = service.prepare("s1", { type: "return_home", summary: "s" });
		await expect(service.confirm("s2", action.id)).rejects.toThrow(ActionError);
	});

	it("cancel moves a pending action to CANCELLED", async () => {
		const { service, store } = createService();
		const action = service.prepare("s1", { type: "return_home", summary: "s" });
		await service.cancel("s1", action.id);
		expect(store.get(action.id)?.status).toBe("CANCELLED");
	});

	it("list filters by session", async () => {
		const { service } = createService();
		service.prepare("s1", { type: "return_home", summary: "a" });
		service.prepare("s2", { type: "point_flight", summary: "b" });
		const s1 = service.list("s1");
		expect(s1).toHaveLength(1);
		expect(s1[0]?.type).toBe("return_home");
	});

	it("runs the executor after confirmation when configured", async () => {
		const execute = vi.fn(async () => ({ ok: true }));
		const { service, store } = createService({ executor: { execute } });
		const action = service.prepare("s1", { type: "return_home", summary: "s" });
		await service.confirm("s1", action.id);
		expect(execute).toHaveBeenCalledOnce();
		const final = store.get(action.id);
		expect(final?.status).toBe("SUCCEEDED");
		expect(final?.result).toEqual({ ok: true });
	});

	it("marks the action FAILED when the executor throws", async () => {
		const { service, store } = createService({
			executor: {
				execute: async () => {
					throw new Error("platform rejected");
				},
			},
		});
		const action = service.prepare("s1", { type: "return_home", summary: "s" });
		await service.confirm("s1", action.id);
		const final = store.get(action.id);
		expect(final?.status).toBe("FAILED");
		expect(final?.error).toBe("platform rejected");
	});
});
