import { describe, expect, it } from "vitest";
import type { UavAgentEvent, UavAgentEventListener } from "../../src/core/events.ts";
import type { SessionContext, UavSessionBackend, UavSessionFactory } from "../../src/core/session-registry.ts";
import { SessionExistsError, SessionRegistry, UnknownSessionError } from "../../src/core/session-registry.ts";

class FakeBackend implements UavSessionBackend {
	readonly sessionId: string;
	closed = false;
	constructor(
		sessionId: string,
		private readonly context: SessionContext,
	) {
		this.sessionId = sessionId;
	}
	getContext(): SessionContext {
		return this.context;
	}
	async sendMessage(): Promise<void> {}
	subscribe(_listener: UavAgentEventListener): () => void {
		return () => {};
	}
	emit(_event: UavAgentEvent): void {}
	async close(): Promise<void> {
		this.closed = true;
	}
}

function createRegistry(): { registry: SessionRegistry; created: FakeBackend[] } {
	const created: FakeBackend[] = [];
	const factory: UavSessionFactory = {
		create: async (options) => {
			const id = options.sessionId ?? `s-${created.length}`;
			const backend = new FakeBackend(id, {
				sessionId: id,
				userId: options.userId ?? "local-user",
				tenantId: options.tenantId,
				channel: options.channel ?? "tui",
			});
			created.push(backend);
			return backend;
		},
	};
	return { registry: new SessionRegistry(factory), created };
}

describe("SessionRegistry recovery", () => {
	it("rejects duplicate ids on create instead of overwriting", async () => {
		const { registry, created } = createRegistry();
		await registry.create({ sessionId: "a" });
		await expect(registry.create({ sessionId: "a" })).rejects.toThrow(SessionExistsError);
		expect(created).toHaveLength(1);
		expect(registry.size).toBe(1);
	});

	it("resume reuses the running backend for an existing id", async () => {
		const { registry, created } = createRegistry();
		await registry.create({ sessionId: "a" });
		const id = await registry.resume({ sessionId: "a" });
		expect(id).toBe("a");
		expect(created).toHaveLength(1);
	});

	it("resume creates a missing session", async () => {
		const { registry, created } = createRegistry();
		await registry.resume({ sessionId: "b" });
		expect(created).toHaveLength(1);
		expect(registry.has("b")).toBe(true);
	});

	it("materializes AgentContext on the backend", async () => {
		const { registry } = createRegistry();
		await registry.create({ sessionId: "c", userId: "u1", tenantId: "t1", channel: "api" });
		const backend = registry.get("c");
		expect(backend.getContext()).toEqual({
			sessionId: "c",
			userId: "u1",
			tenantId: "t1",
			channel: "api",
		});
	});

	it("closes the old backend on remove so listeners do not leak", async () => {
		const { registry, created } = createRegistry();
		await registry.create({ sessionId: "a" });
		await registry.remove("a");
		expect(created[0]?.closed).toBe(true);
		expect(() => registry.get("a")).toThrow(UnknownSessionError);
	});

	it("removing and recreating the same id works after close", async () => {
		const { registry, created } = createRegistry();
		await registry.create({ sessionId: "a" });
		await registry.remove("a");
		await registry.create({ sessionId: "a" });
		expect(created).toHaveLength(2);
		expect(registry.size).toBe(1);
	});
});
