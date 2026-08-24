import { describe, expect, it } from "vitest";
import type { UavAgentEvent, UavAgentEventListener } from "../../src/core/events.ts";
import {
	SessionRegistry,
	type UavSessionBackend,
	type UavSessionFactory,
	UnknownSessionError,
} from "../../src/core/session-registry.ts";

class FakeBackend implements UavSessionBackend {
	readonly sessionId: string;
	messages: string[] = [];
	closed = false;
	private readonly listeners = new Set<UavAgentEventListener>();

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	async sendMessage(message: string): Promise<void> {
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

function createRegistry(factory?: UavSessionFactory): { registry: SessionRegistry; backends: FakeBackend[] } {
	const backends: FakeBackend[] = [];
	const registry = new SessionRegistry(
		factory ?? {
			create: async (options) => {
				const backend = new FakeBackend(options.sessionId ?? `s-${backends.length}`);
				backends.push(backend);
				return backend;
			},
		},
	);
	return { registry, backends };
}

describe("SessionRegistry", () => {
	it("creates a session and returns its id", async () => {
		const { registry, backends } = createRegistry();
		const id = await registry.create({ sessionId: "local-default" });
		expect(id).toBe("local-default");
		expect(registry.has("local-default")).toBe(true);
		expect(backends).toHaveLength(1);
	});

	it("supports multiple concurrent sessions", async () => {
		const { registry } = createRegistry();
		await registry.create({ sessionId: "a" });
		await registry.create({ sessionId: "b" });
		expect(registry.size).toBe(2);
		expect(registry.list().sort()).toEqual(["a", "b"]);
	});

	it("throws UnknownSessionError for unknown sessions", () => {
		const { registry } = createRegistry();
		expect(() => registry.get("nope")).toThrow(UnknownSessionError);
	});

	it("removes and closes a session", async () => {
		const { registry, backends } = createRegistry();
		await registry.create({ sessionId: "a" });
		expect(await registry.remove("a")).toBe(true);
		expect(registry.has("a")).toBe(false);
		expect(backends[0]?.closed).toBe(true);
		expect(await registry.remove("a")).toBe(false);
	});

	it("closes all sessions", async () => {
		const { registry, backends } = createRegistry();
		await registry.create({ sessionId: "a" });
		await registry.create({ sessionId: "b" });
		await registry.closeAll();
		expect(registry.size).toBe(0);
		expect(backends.every((backend) => backend.closed)).toBe(true);
	});
});
