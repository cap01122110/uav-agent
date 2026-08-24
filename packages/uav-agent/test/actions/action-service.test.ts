import { describe, expect, it, vi } from "vitest";
import { ActionService, type ActionServiceOptions } from "../../src/actions/action-service.ts";
import type { ActionStore } from "../../src/actions/action-store.ts";
import { InMemoryActionStore } from "../../src/actions/action-store.ts";
import type { UavAction } from "../../src/actions/types.ts";
import { ActionError } from "../../src/actions/types.ts";
import type { UavAgentEvent } from "../../src/core/events.ts";

function createService(options: ActionServiceOptions = {}) {
	const store = new InMemoryActionStore();
	const service = new ActionService(store, options);
	return { service, store };
}

describe("ActionService", () => {
	it("prepare creates a WAITING_CONFIRMATION action and emits confirmation_required", () => {
		const emitted: Array<{ sessionId: string; event: UavAgentEvent }> = [];
		const { service } = createService({
			onActionEvent: (sessionId, event) => emitted.push({ sessionId, event }),
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

	it("marks the action FAILED and throws when the executor throws", async () => {
		const { service, store } = createService({
			executor: {
				execute: async () => {
					throw new Error("platform rejected");
				},
			},
		});
		const action = service.prepare("s1", { type: "return_home", summary: "s" });
		await expect(service.confirm("s1", action.id)).rejects.toThrow(/platform rejected/);
		const final = store.get(action.id);
		expect(final?.status).toBe("FAILED");
		expect(final?.error).toBe("platform rejected");
	});

	it("returns SUCCEEDED when the executor succeeds", async () => {
		const { service } = createService({
			executor: { execute: async () => ({ ok: true }) },
		});
		const action = service.prepare("s1", { type: "return_home", summary: "s" });
		const result = await service.confirm("s1", action.id);
		expect(result.status).toBe("SUCCEEDED");
	});

	it("resolves actions by unique session-scoped prefix", async () => {
		const { service } = createService();
		const action = service.prepare("s1", { type: "return_home", summary: "a" });
		expect(service.resolve("s1", action.id.slice(0, 8)).id).toBe(action.id);
	});

	it("rejects ambiguous id prefixes", async () => {
		const a1: UavAction = {
			id: "abcd1234-first",
			sessionId: "s1",
			type: "return_home",
			summary: "a",
			status: "WAITING_CONFIRMATION",
			createdAt: 1,
			updatedAt: 1,
		};
		const a2: UavAction = { ...a1, id: "abcd1234-second", type: "point_flight" };
		const store: ActionStore = {
			create: () => a1,
			get: () => undefined,
			list: () => [a1, a2],
			transition: () => ({ actionId: "x", status: "PREPARED" }),
			confirm: () => ({ actionId: "x", status: "CONFIRMED" }),
			cancel: () => ({ actionId: "x", status: "CANCELLED" }),
			expire: () => ({ actionId: "x", status: "EXPIRED" }),
		};
		const service = new ActionService(store);
		expect(() => service.resolve("s1", "abcd1234")).toThrow(/Ambiguous/);
	});
});
