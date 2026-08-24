import { describe, expect, it } from "vitest";
import { type ActionStore, InMemoryActionStore } from "../../src/actions/action-store.ts";
import { ActionError } from "../../src/actions/types.ts";
import type { UavAgentEvent, UavAgentEventListener } from "../../src/core/events.ts";
import { UavAgentRuntimeImpl } from "../../src/core/runtime.ts";
import type { CreateSessionOptions, UavSessionBackend } from "../../src/core/session-registry.ts";
import { UnknownSessionError } from "../../src/core/session-registry.ts";

class FakeBackend implements UavSessionBackend {
	readonly sessionId: string;
	messages: string[] = [];
	closed = false;
	failSend = false;
	readonly listeners = new Set<UavAgentEventListener>();

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	async sendMessage(message: string): Promise<void> {
		if (this.failSend) {
			throw new Error("backend exploded");
		}
		this.messages.push(message);
	}

	subscribe(listener: UavAgentEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: UavAgentEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	async close(): Promise<void> {
		this.closed = true;
	}
}

function createRuntime(actions?: ActionStore): { runtime: UavAgentRuntimeImpl; backends: FakeBackend[] } {
	const backends: FakeBackend[] = [];
	const runtime = new UavAgentRuntimeImpl({
		factory: {
			create: async (options: CreateSessionOptions) => {
				const backend = new FakeBackend(options.sessionId ?? `s-${backends.length}`);
				backends.push(backend);
				return backend;
			},
		},
		actions,
	});
	return { runtime, backends };
}

describe("UavAgentRuntimeImpl", () => {
	it("creates sessions and routes messages to the right backend", async () => {
		const { runtime, backends } = createRuntime();
		const a = await runtime.createSession({ sessionId: "a" });
		const b = await runtime.createSession({ sessionId: "b" });
		await runtime.sendMessage(a, "hello a");
		await runtime.sendMessage(b, "hello b");
		expect(backends[0]?.messages).toEqual(["hello a"]);
		expect(backends[1]?.messages).toEqual(["hello b"]);
	});

	it("forwards backend events to subscribers", async () => {
		const { runtime, backends } = createRuntime();
		const id = await runtime.createSession({ sessionId: "a" });
		const received: UavAgentEvent[] = [];
		const unsubscribe = runtime.subscribe(id, (event) => received.push(event));

		backends[0]?.emit({ type: "message.delta", content: "part" });
		backends[0]?.emit({ type: "message.completed", content: "part" });
		expect(received).toEqual([
			{ type: "message.delta", content: "part" },
			{ type: "message.completed", content: "part" },
		]);

		unsubscribe();
		backends[0]?.emit({ type: "turn.completed" });
		expect(received).toHaveLength(2);
	});

	it("emits an error event when sendMessage fails", async () => {
		const { runtime, backends } = createRuntime();
		const id = await runtime.createSession({ sessionId: "a" });
		const received: UavAgentEvent[] = [];
		runtime.subscribe(id, (event) => received.push(event));
		backends[0]!.failSend = true;

		await runtime.sendMessage(id, "boom");
		expect(received).toEqual([{ type: "error", code: "INTERNAL_ERROR", message: "backend exploded" }]);
	});

	it("throws for unknown sessions on sendMessage and subscribe", async () => {
		const { runtime } = createRuntime();
		await expect(runtime.sendMessage("missing", "hi")).rejects.toThrow(UnknownSessionError);
		expect(() => runtime.subscribe("missing", () => {})).toThrow(UnknownSessionError);
	});

	it("confirms and cancels actions owned by the session", async () => {
		const store = new InMemoryActionStore();
		const { runtime } = createRuntime(store);
		const id = await runtime.createSession({ sessionId: "a" });
		const action = store.create({
			sessionId: id,
			type: "return_home",
			summary: "Return home",
		});
		// A prepared action must first enter WAITING_CONFIRMATION before it can be confirmed.
		store.transition(action.id, "WAITING_CONFIRMATION");

		const result = await runtime.confirmAction(id, action.id);
		expect(result.status).toBe("CONFIRMED");
		expect(store.get(action.id)?.status).toBe("CONFIRMED");
	});

	it("cancels a pending action", async () => {
		const store = new InMemoryActionStore();
		const { runtime } = createRuntime(store);
		const id = await runtime.createSession({ sessionId: "a" });
		const action = store.create({
			sessionId: id,
			type: "return_home",
			summary: "Return home",
		});

		await runtime.cancelAction(id, action.id);
		expect(store.get(action.id)?.status).toBe("CANCELLED");
	});

	it("rejects confirmAction for an action owned by another session", async () => {
		const store = new InMemoryActionStore();
		const { runtime } = createRuntime(store);
		const a = await runtime.createSession({ sessionId: "a" });
		const b = await runtime.createSession({ sessionId: "b" });
		const action = store.create({ sessionId: a, type: "return_home", summary: "s" });
		await expect(runtime.confirmAction(b, action.id)).rejects.toThrow(ActionError);
	});

	it("closes sessions on close()", async () => {
		const { runtime, backends } = createRuntime();
		await runtime.createSession({ sessionId: "a" });
		await runtime.createSession({ sessionId: "b" });
		await runtime.close();
		expect(backends.every((backend) => backend.closed)).toBe(true);
	});
});
