import { describe, expect, it } from "vitest";
import { createPlatformClientFromEnv, createTokenProvider, loadPlatformConfig } from "../../src/platform/config.ts";

describe("loadPlatformConfig", () => {
	it("reads all supported environment variables", () => {
		const config = loadPlatformConfig({
			UAV_PLATFORM_URL: "https://platform.example.com",
			UAV_AGENT_CLIENT_ID: "client-1",
			UAV_AGENT_CLIENT_SECRET: "super-secret",
			UAV_PLATFORM_TOKEN_URL: "https://platform.example.com/token",
			UAV_PLATFORM_TIMEOUT_MS: "5000",
		});
		expect(config.baseUrl).toBe("https://platform.example.com");
		expect(config.clientId).toBe("client-1");
		expect(config.clientSecret).toBe("super-secret");
		expect(config.tokenUrl).toBe("https://platform.example.com/token");
		expect(config.timeoutMs).toBe(5000);
	});

	it("defaults to empty when unset", () => {
		const config = loadPlatformConfig({});
		expect(config.baseUrl).toBe("");
		expect(config.clientId).toBeUndefined();
	});
});

describe("createTokenProvider", () => {
	it("prefers a static token over client credentials", async () => {
		const provider = createTokenProvider({
			baseUrl: "https://platform.example.com",
			token: "static-token",
			clientId: "client-1",
			clientSecret: "super-secret",
		});
		expect(await provider.getToken()).toBe("static-token");
	});

	it("throws when no credentials are configured", () => {
		expect(() => createTokenProvider({ baseUrl: "https://platform.example.com" })).toThrow(/credentials/);
	});

	it("defaults token url from the base url", () => {
		const provider = createTokenProvider({
			baseUrl: "https://platform.example.com/",
			clientId: "client-1",
			clientSecret: "secret",
		});
		expect(provider).toBeDefined();
	});
});

describe("createPlatformClientFromEnv", () => {
	it("creates a client when configured", () => {
		const client = createPlatformClientFromEnv({
			UAV_PLATFORM_URL: "https://platform.example.com",
			UAV_PLATFORM_TOKEN: "static-token",
		});
		expect(client.airport).toBeDefined();
		expect(client.drone).toBeDefined();
		expect(client.mission).toBeDefined();
		expect(client.safety).toBeDefined();
	});

	it("throws without UAV_PLATFORM_URL", () => {
		expect(() => createPlatformClientFromEnv({})).toThrow(/UAV_PLATFORM_URL/);
	});
});
