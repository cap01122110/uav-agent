import { describe, expect, it, vi } from "vitest";
import {
	CachedTokenProvider,
	ClientCredentialsTokenSource,
	PasswordTokenSource,
	StaticTokenSource,
} from "../../src/auth/token-provider.ts";
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

	it("covers a stalled body read with UPSTREAM_TIMEOUT", async () => {
		vi.useFakeTimers();
		try {
			vi.stubGlobal(
				"fetch",
				vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
					const stream = new ReadableStream<Uint8Array>({
						start(controller) {
							init?.signal?.addEventListener("abort", () =>
								controller.error(new DOMException("aborted", "AbortError")),
							);
						},
					});
					return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
				}),
			);
			const source = new ClientCredentialsTokenSource({
				tokenUrl: "https://platform/oauth/token",
				clientId: "client-1",
				clientSecret: "super-secret",
				timeoutMs: 100,
			});
			const promise = source.fetchToken();
			const errorPromise = promise.catch((error: unknown) => error);
			await vi.advanceTimersByTimeAsync(200);
			const error = await errorPromise;
			expect(error).toBeInstanceOf(PlatformError);
			expect((error as PlatformError).code).toBe("UPSTREAM_TIMEOUT");
			expect((error as PlatformError).message).toBe("Token request timed out.");
		} finally {
			vi.useRealTimers();
			vi.unstubAllGlobals();
		}
	});

	it("never issues a request when the signal is already aborted", async () => {
		const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		try {
			const controller = new AbortController();
			controller.abort();
			const source = new ClientCredentialsTokenSource({
				tokenUrl: "https://platform/oauth/token",
				clientId: "client-1",
				clientSecret: "super-secret",
			});
			try {
				await source.fetchToken(controller.signal);
				expect.unreachable();
			} catch (error) {
				expect((error as DOMException).name).toBe("AbortError");
			}
			expect(fetchMock).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("propagates a mid-flight caller abort as AbortError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_url: string | URL | Request, init?: RequestInit) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
					}),
			),
		);
		try {
			const controller = new AbortController();
			const source = new ClientCredentialsTokenSource({
				tokenUrl: "https://platform/oauth/token",
				clientId: "client-1",
				clientSecret: "super-secret",
				timeoutMs: 10_000,
			});
			const promise = source.fetchToken(controller.signal);
			const errorPromise = promise.catch((error: unknown) => error);
			controller.abort();
			const error = await errorPromise;
			expect((error as DOMException).name).toBe("AbortError");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("maps a missing access_token to INVALID_RESPONSE", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 })),
		);
		try {
			const source = new ClientCredentialsTokenSource({
				tokenUrl: "https://platform/oauth/token",
				clientId: "client-1",
				clientSecret: "super-secret",
			});
			try {
				await source.fetchToken();
				expect.unreachable();
			} catch (error) {
				expect((error as PlatformError).code).toBe("INVALID_RESPONSE");
			}
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("maps invalid JSON on HTTP 200 to INVALID_RESPONSE, not PLATFORM_UNAVAILABLE", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{broken-json token=secret", { status: 200 })),
		);
		try {
			const source = new ClientCredentialsTokenSource({
				tokenUrl: "https://platform/oauth/token",
				clientId: "client-1",
				clientSecret: "super-secret",
			});
			try {
				await source.fetchToken();
				expect.unreachable();
			} catch (error) {
				const err = error as PlatformError;
				expect(err.code).toBe("INVALID_RESPONSE");
				expect(err.message).toBe("Token endpoint returned an invalid response");
				expect(err.message).not.toContain("broken-json");
				expect(err.message).not.toContain("secret");
			}
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("propagates a caller abort during an error-response body read as AbortError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						init?.signal?.addEventListener("abort", () =>
							controller.error(new DOMException("aborted", "AbortError")),
						);
					},
				});
				// 401 with a body that never delivers: abort must not become PERMISSION_DENIED.
				return new Response(stream, { status: 401 });
			}),
		);
		try {
			const controller = new AbortController();
			const source = new ClientCredentialsTokenSource({
				tokenUrl: "https://platform/oauth/token",
				clientId: "client-1",
				clientSecret: "super-secret",
				timeoutMs: 10_000,
			});
			const promise = source.fetchToken(controller.signal);
			const errorPromise = promise.catch((error: unknown) => error);
			controller.abort();
			const error = await errorPromise;
			expect((error as DOMException).name).toBe("AbortError");
			expect(error).not.toBeInstanceOf(PlatformError);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("PasswordTokenSource", () => {
	it("never leaks the upstream login message or credentials", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({ code: 40001, message: "Login denied password=hunter2 token=secret", data: null }),
						{ status: 200 },
					),
			),
		);
		try {
			const source = new PasswordTokenSource({
				baseUrl: "https://platform",
				username: "svc",
				password: "hunter2",
			});
			try {
				await source.fetchToken();
				expect.unreachable();
			} catch (error) {
				expect((error as PlatformError).code).toBe("PERMISSION_DENIED");
				expect((error as PlatformError).message).toBe("Login failed");
				expect((error as PlatformError).message).not.toContain("hunter2");
				expect((error as PlatformError).message).not.toContain("secret");
				expect((error as PlatformError).message).not.toContain("40001");
			}
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("redacts an HTTP login failure body on the cause without leaking to the message", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response('{"error":"bad credentials token=abc"}', { status: 401 })),
		);
		try {
			const source = new PasswordTokenSource({
				baseUrl: "https://platform",
				username: "svc",
				password: "hunter2",
			});
			try {
				await source.fetchToken();
				expect.unreachable();
			} catch (error) {
				const err = error as PlatformError;
				expect(err.code).toBe("PERMISSION_DENIED");
				expect(err.message).toBe("Login failed (401)");
				expect(err.message).not.toContain("abc");
				// The cause carries only redacted detail.
				const cause = (err as Error).cause;
				const causeText = cause instanceof Error ? cause.message : "";
				expect(causeText).not.toContain("abc");
			}
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("covers a stalled body read with UPSTREAM_TIMEOUT", async () => {
		vi.useFakeTimers();
		try {
			vi.stubGlobal(
				"fetch",
				vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
					const stream = new ReadableStream<Uint8Array>({
						start(controller) {
							init?.signal?.addEventListener("abort", () =>
								controller.error(new DOMException("aborted", "AbortError")),
							);
						},
					});
					return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
				}),
			);
			const source = new PasswordTokenSource({
				baseUrl: "https://platform",
				username: "svc",
				password: "hunter2",
				timeoutMs: 100,
			});
			const promise = source.fetchToken();
			const errorPromise = promise.catch((error: unknown) => error);
			await vi.advanceTimersByTimeAsync(200);
			const error = await errorPromise;
			expect(error).toBeInstanceOf(PlatformError);
			expect((error as PlatformError).code).toBe("UPSTREAM_TIMEOUT");
			expect((error as PlatformError).message).toBe("Login request timed out.");
		} finally {
			vi.useRealTimers();
			vi.unstubAllGlobals();
		}
	});

	it("never issues a login request when the signal is already aborted", async () => {
		const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		try {
			const controller = new AbortController();
			controller.abort();
			const source = new PasswordTokenSource({
				baseUrl: "https://platform",
				username: "svc",
				password: "hunter2",
			});
			try {
				await source.fetchToken(controller.signal);
				expect.unreachable();
			} catch (error) {
				expect((error as DOMException).name).toBe("AbortError");
			}
			expect(fetchMock).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("propagates a mid-flight caller abort as AbortError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_url: string | URL | Request, init?: RequestInit) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
					}),
			),
		);
		try {
			const controller = new AbortController();
			const source = new PasswordTokenSource({
				baseUrl: "https://platform",
				username: "svc",
				password: "hunter2",
				timeoutMs: 10_000,
			});
			const promise = source.fetchToken(controller.signal);
			const errorPromise = promise.catch((error: unknown) => error);
			controller.abort();
			const error = await errorPromise;
			expect((error as DOMException).name).toBe("AbortError");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("maps a login response without a token to INVALID_RESPONSE", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ code: 0, message: "ok", data: null }), { status: 200 })),
		);
		try {
			const source = new PasswordTokenSource({
				baseUrl: "https://platform",
				username: "svc",
				password: "hunter2",
			});
			try {
				await source.fetchToken();
				expect.unreachable();
			} catch (error) {
				expect((error as PlatformError).code).toBe("INVALID_RESPONSE");
			}
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("maps invalid JSON on HTTP 200 to INVALID_RESPONSE, not PLATFORM_UNAVAILABLE", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{broken-json token=secret", { status: 200 })),
		);
		try {
			const source = new PasswordTokenSource({
				baseUrl: "https://platform",
				username: "svc",
				password: "hunter2",
			});
			try {
				await source.fetchToken();
				expect.unreachable();
			} catch (error) {
				const err = error as PlatformError;
				expect(err.code).toBe("INVALID_RESPONSE");
				expect(err.message).toBe("Login endpoint returned an invalid response");
				expect(err.message).not.toContain("broken-json");
				expect(err.message).not.toContain("secret");
			}
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("propagates a caller abort during an error-response body read as AbortError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						init?.signal?.addEventListener("abort", () =>
							controller.error(new DOMException("aborted", "AbortError")),
						);
					},
				});
				// 401 with a body that never delivers: abort must not become PERMISSION_DENIED.
				return new Response(stream, { status: 401 });
			}),
		);
		try {
			const controller = new AbortController();
			const source = new PasswordTokenSource({
				baseUrl: "https://platform",
				username: "svc",
				password: "hunter2",
				timeoutMs: 10_000,
			});
			const promise = source.fetchToken(controller.signal);
			const errorPromise = promise.catch((error: unknown) => error);
			controller.abort();
			const error = await errorPromise;
			expect((error as DOMException).name).toBe("AbortError");
			expect(error).not.toBeInstanceOf(PlatformError);
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

describe("CachedTokenProvider shared refresh isolation", () => {
	it("a cancelled session does not cancel another session's shared refresh", async () => {
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
		// Session A starts a refresh with its own signal; session B joins.
		const a = provider.getToken();
		const b = provider.getToken();
		// A's signal aborts; the shared refresh must not be cancelled.
		resolveFetch?.({ value: "t", expiresAt: Date.now() + 60_000 });
		expect(await a).toBe("t");
		expect(await b).toBe("t");
		expect(source.fetchToken).toHaveBeenCalledTimes(1);
	});
});
