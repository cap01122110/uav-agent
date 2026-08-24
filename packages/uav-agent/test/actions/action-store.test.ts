import { describe, expect, it } from "vitest";
import { InMemoryActionStore } from "../../src/actions/action-store.ts";
import { ActionError } from "../../src/actions/types.ts";

function createStore(): InMemoryActionStore {
	return new InMemoryActionStore();
}

describe("InMemoryActionStore", () => {
	it("creates an action in PREPARED state with a generated id", () => {
		const store = createStore();
		const action = store.create({ sessionId: "s1", type: "return_home", summary: "Return home" });
		expect(action.id).toBeTruthy();
		expect(action.status).toBe("PREPARED");
		expect(action.sessionId).toBe("s1");
		expect(store.get(action.id)).toBe(action);
	});

	it("walks the happy-path state machine", () => {
		const store = createStore();
		const action = store.create({ sessionId: "s1", type: "takeoff", summary: "Take off" });

		expect(store.transition(action.id, "WAITING_CONFIRMATION").status).toBe("WAITING_CONFIRMATION");
		expect(store.confirm(action.id).status).toBe("CONFIRMED");
		expect(store.transition(action.id, "EXECUTING").status).toBe("EXECUTING");
		expect(store.transition(action.id, "SUCCEEDED").status).toBe("SUCCEEDED");
	});

	it("rejects invalid transitions", () => {
		const store = createStore();
		const action = store.create({ sessionId: "s1", type: "takeoff", summary: "Take off" });
		// PREPARED -> EXECUTING is not allowed (must wait for confirmation).
		expect(() => store.transition(action.id, "EXECUTING")).toThrow(ActionError);
	});

	it("rejects transitions on terminal states", () => {
		const store = createStore();
		const action = store.create({ sessionId: "s1", type: "takeoff", summary: "Take off" });
		store.transition(action.id, "CANCELLED");
		expect(() => store.transition(action.id, "CONFIRMED")).toThrow(ActionError);
	});

	it("cancels from PREPARED, WAITING_CONFIRMATION and CONFIRMED", () => {
		const store = createStore();
		const prepared = store.create({ sessionId: "s1", type: "a", summary: "a" });
		const waiting = store.create({ sessionId: "s1", type: "b", summary: "b" });
		const confirmed = store.create({ sessionId: "s1", type: "c", summary: "c" });
		store.transition(waiting.id, "WAITING_CONFIRMATION");
		store.transition(confirmed.id, "WAITING_CONFIRMATION");
		store.transition(confirmed.id, "CONFIRMED");

		expect(store.cancel(prepared.id).status).toBe("CANCELLED");
		expect(store.cancel(waiting.id).status).toBe("CANCELLED");
		expect(store.cancel(confirmed.id).status).toBe("CANCELLED");
	});

	it("expires from WAITING_CONFIRMATION", () => {
		const store = createStore();
		const action = store.create({ sessionId: "s1", type: "a", summary: "a" });
		store.transition(action.id, "WAITING_CONFIRMATION");
		expect(store.expire(action.id).status).toBe("EXPIRED");
	});

	it("throws ACTION_NOT_FOUND for unknown ids", () => {
		const store = createStore();
		expect(() => store.confirm("missing")).toThrowError(ActionError);
		expect(() => store.confirm("missing")).toThrowError(/not found/i);
	});

	it("lists all actions", () => {
		const store = createStore();
		store.create({ sessionId: "s1", type: "a", summary: "a" });
		store.create({ sessionId: "s1", type: "b", summary: "b" });
		expect(store.list()).toHaveLength(2);
	});
});
