import { describe, expect, it, vi } from "vitest";
import { CachedTokenProvider, ClientCredentialsTokenSource, StaticTokenSource } from "../../src/auth/token-provider.ts";
import { PlatformError } from "../../src/platform/errors.ts";

describe("CachedTokenProvider", () => {
	it("caches the token until near expiry", async () => {
		const now = 1_000_000_000_000;
		const source = {
			fetchToken: vi.fn(async () => ({ value: "t1", expiresAt: now + 60_000 })),
		};
		const provider = new CachedTokenProvider(source, () => now);
		expect(await provider.getToken()).toBe("t1");
		expect(await provider.getToken()).toBe("t1");
		expect(source.fetchToken).toHaveBeenCalledTimes(1);
	});

	it("refreshes after the expiry margin", async () => {
		let now = 1_000_000_000_000;
		const source = {
			fetchToken: vi.fn(async () => ({ value: "t1", expiresAt: now + 60_000 })),
		};
		const provider = new CachedTokenProvider(source, () => now);
		await provider.getToken();
		// Advance past the 30s refresh margin.
		now += 40_000;
		source.fetchToken.mockResolvedValue({ value: "t2", expiresAt: now + 60_000 });
		expect(await provider.getToken()).toBe("t2");
		expect(source.fetchToken).toHaveBeenCalledTimes(2);
	});

	it("deduplicates concurrent refresh calls", async () => {
		let resolveFetch: ((token: { value: string; expiresAt: number }) => void) | undefined;
		const source = {
			fetchToken: vi.fn(
				() =>
					new Promise<{ value: string; expiresAt: number }>((resolve) => {
						resolveFetch = resolve;
					}),
			),
		};
		const provider = new CachedTokenProvider(source, () => 1_000_000_000_000);
		const first = provider.getToken();
		const second = provider.getToken();
		resolveFetch?.({ value: "t", expiresAt: Date.now() + 60_000 });
		expect(await first).toBe("t");
		expect(await second).toBe("t");
		expect(source.fetchToken).toHaveBeenCalledTimes(1);
	});
});

describe("ClientCredentialsTokenSource", () => {
	it("posts client credentials and parses the token", async () => {
		let captured: { url: string; init: RequestInit } | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
				captured = { url: String(url), init: init ?? {} };
				return new Response(JSON.stringify({ access_token: "abc", expires_in: 3600 }), { status: 200 });
			}),
		);
		try {
			const source = new ClientCredentialsTokenSource({
				tokenUrl: "https://platform/oauth/token",
				clientId: "client-1",
				clientSecret: "super-secret",
			});
			const token = await source.fetchToken();
			expect(token.value).toBe("abc");
			expect(token.expiresAt).toBeGreaterThan(Date.now());

			const body = captured?.init.body;
			const params = new URLSearchParams(body as string);
			expect(params.get("grant_type")).toBe("client_credentials");
			expect(params.get("client_id")).toBe("client-1");
			expect(params.get("client_secret")).toBe("super-secret");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("maps a failed token request to PERMISSION_DENIED", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("invalid_grant", { status: 401 })),
		);
		try {
			const source = new ClientCredentialsTokenSource({
				tokenUrl: "https://platform/oauth/token",
				clientId: "client-1",
				clientSecret: "super-secret",
			});
			const error = await expect(source.fetchToken()).rejects.toThrow(PlatformError);
			await error;
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("does not leak the secret in errors or messages", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("boom", { status: 500 })),
		);
		try {
			const source = new ClientCredentialsTokenSource({
				tokenUrl: "https://platform/oauth/token",
				clientId: "client-1",
				clientSecret: "super-secret",
			});
			try {
				await source.fetchToken();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				expect(message).not.toContain("super-secret");
			}
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("StaticTokenSource", () => {
	it("returns the static token forever", async () => {
		const source = new StaticTokenSource("static-token");
		const token = await source.fetchToken();
		expect(token.value).toBe("static-token");
		expect(token.expiresAt).toBe(Number.POSITIVE_INFINITY);
	});
});
