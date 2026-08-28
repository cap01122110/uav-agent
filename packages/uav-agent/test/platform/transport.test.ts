import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformError } from "../../src/platform/errors.ts";
import { FetchHttpTransport } from "../../src/platform/transport.ts";

afterEach(() => {
	vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string | URL | Request, init?: RequestInit) => impl(String(url), init)),
	);
}

describe("FetchHttpTransport", () => {
	it("sends request id and parses JSON", async () => {
		let requestId: string | undefined;
		stubFetch(async (_url, init) => {
			requestId = init?.headers ? (init.headers as Record<string, string>)["x-request-id"] : undefined;
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		});
		const transport = new FetchHttpTransport();
		const result = await transport.request<{ ok: boolean }>({
			method: "GET",
			url: "https://platform/api/v1/airports/A/status",
		});
		expect(result.ok).toBe(true);
		expect(requestId).toBeTruthy();
	});

	it("appends query parameters", async () => {
		let calledUrl: string | undefined;
		stubFetch(async (url) => {
			calledUrl = url;
			return new Response("null", { status: 200 });
		});
		const transport = new FetchHttpTransport();
		await transport.request({ method: "GET", url: "https://platform/x", query: { a: 1, b: "two", c: undefined } });
		expect(calledUrl).toBe("https://platform/x?a=1&b=two");
	});

	it("maps HTTP 403 to PERMISSION_DENIED", async () => {
		stubFetch(async () => new Response("forbidden", { status: 403 }));
		const transport = new FetchHttpTransport();
		try {
			await transport.request({ method: "GET", url: "https://platform/x" });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(PlatformError);
			expect((error as PlatformError).code).toBe("PERMISSION_DENIED");
			expect((error as PlatformError).retryable).toBe(false);
			expect((error as PlatformError).message).toBe("UAV platform permission denied.");
		}
	});

	it("never leaks the response body into the public message", async () => {
		const leakyBody =
			'{"message":"SQL failed password=abc123","stackTrace":"at org.springframework...","token":"eyJsecret"}';
		stubFetch(async () => new Response(leakyBody, { status: 500 }));
		const transport = new FetchHttpTransport();
		try {
			await transport.request({ method: "GET", url: "https://platform/x" });
			expect.unreachable();
		} catch (error) {
			expect((error as PlatformError).code).toBe("PLATFORM_UNAVAILABLE");
			expect((error as PlatformError).message).toBe("UAV platform is unavailable.");
			expect((error as PlatformError).message).not.toContain("password");
			expect((error as PlatformError).message).not.toContain("token");
			expect((error as PlatformError).message).not.toContain("stackTrace");
			expect((error as PlatformError).message).not.toContain("SQL");
			expect((error as PlatformError).status).toBe(500);
		}
	});

	it("maps a 403 body with credentials to PERMISSION_DENIED without leaking", async () => {
		stubFetch(async () => new Response('{"error":"unauthorized token=abc password=hunter2"}', { status: 403 }));
		const transport = new FetchHttpTransport();
		try {
			await transport.request({ method: "GET", url: "https://platform/x" });
			expect.unreachable();
		} catch (error) {
			expect((error as PlatformError).code).toBe("PERMISSION_DENIED");
			expect((error as PlatformError).message).not.toContain("abc");
			expect((error as PlatformError).message).not.toContain("hunter2");
		}
	});

	it("maps invalid JSON on HTTP 200 to INVALID_RESPONSE without the raw body", async () => {
		stubFetch(async () => new Response("this is not json password=secret", { status: 200 }));
		const transport = new FetchHttpTransport();
		try {
			await transport.request({ method: "GET", url: "https://platform/x" });
			expect.unreachable();
		} catch (error) {
			expect((error as PlatformError).code).toBe("INVALID_RESPONSE");
			expect((error as PlatformError).message).toBe("UAV platform returned an invalid response.");
			expect((error as PlatformError).message).not.toContain("not json");
			expect((error as PlatformError).message).not.toContain("secret");
		}
	});

	it("keeps HTTP 404 status without leaking the response body", async () => {
		stubFetch(async () => new Response('{"message":"no such airport token=abc"}', { status: 404 }));
		const transport = new FetchHttpTransport();
		try {
			await transport.request({ method: "GET", url: "https://platform/x" });
			expect.unreachable();
		} catch (error) {
			expect((error as PlatformError).status).toBe(404);
			expect((error as PlatformError).message).toBe("UAV platform resource not found.");
			expect((error as PlatformError).message).not.toContain("abc");
		}
	});

	it("maps HTTP 503 to PLATFORM_UNAVAILABLE (retryable)", async () => {
		stubFetch(async () => new Response("unavailable", { status: 503 }));
		const transport = new FetchHttpTransport();
		try {
			await transport.request({ method: "GET", url: "https://platform/x" });
			expect.unreachable();
		} catch (error) {
			expect((error as PlatformError).code).toBe("PLATFORM_UNAVAILABLE");
			expect((error as PlatformError).retryable).toBe(true);
		}
	});

	it("maps network failures to PLATFORM_UNAVAILABLE", async () => {
		stubFetch(async () => {
			throw new TypeError("fetch failed");
		});
		const transport = new FetchHttpTransport();
		try {
			await transport.request({ method: "GET", url: "https://platform/x" });
			expect.unreachable();
		} catch (error) {
			expect((error as PlatformError).code).toBe("PLATFORM_UNAVAILABLE");
			expect((error as PlatformError).retryable).toBe(true);
		}
	});

	it("maps timeouts to UPSTREAM_TIMEOUT", async () => {
		vi.useFakeTimers();
		try {
			stubFetch(
				(_url, init) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
					}),
			);
			const transport = new FetchHttpTransport({ timeoutMs: 100 });
			const promise = transport.request({ method: "GET", url: "https://platform/x" });
			const errorPromise = promise.catch((error: unknown) => error);
			await vi.advanceTimersByTimeAsync(200);
			const error = await errorPromise;
			expect(error).toBeInstanceOf(PlatformError);
			expect((error as PlatformError).code).toBe("UPSTREAM_TIMEOUT");
			expect((error as PlatformError).retryable).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("covers a body read that stalls after headers arrive (timeout during response.text)", async () => {
		vi.useFakeTimers();
		try {
			// fetch resolves with a Response whose body stream never delivers data;
			// only an abort cancels the read. The timeout must still fire.
			stubFetch(async (_url, init) => {
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						init?.signal?.addEventListener("abort", () =>
							controller.error(new DOMException("aborted", "AbortError")),
						);
					},
				});
				return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
			});
			const transport = new FetchHttpTransport({ timeoutMs: 100 });
			const promise = transport.request({ method: "GET", url: "https://platform/x" });
			const errorPromise = promise.catch((error: unknown) => error);
			await vi.advanceTimersByTimeAsync(200);
			const error = await errorPromise;
			expect(error).toBeInstanceOf(PlatformError);
			expect((error as PlatformError).code).toBe("UPSTREAM_TIMEOUT");
			expect((error as PlatformError).message).toBe("UAV platform request timed out.");
		} finally {
			vi.useRealTimers();
		}
	});

	it("rethrows the caller's abort error", async () => {
		const controller = new AbortController();
		stubFetch(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
				}),
		);
		const transport = new FetchHttpTransport({ timeoutMs: 10_000 });
		const promise = transport.request({ method: "GET", url: "https://platform/x", signal: controller.signal });
		const errorPromise = promise.catch((error: unknown) => error);
		controller.abort();
		const error = await errorPromise;
		expect((error as DOMException).name).toBe("AbortError");
	});
});

describe("FetchHttpTransport abort and timeout boundaries", () => {
	it("never issues a request when the signal is already aborted", async () => {
		let called = false;
		stubFetch(async () => {
			called = true;
			return new Response("{}", { status: 200 });
		});
		const controller = new AbortController();
		controller.abort();
		const transport = new FetchHttpTransport();
		try {
			await transport.request({ method: "GET", url: "https://platform/x", signal: controller.signal });
			expect.unreachable();
		} catch (error) {
			expect((error as DOMException).name).toBe("AbortError");
		}
		expect(called).toBe(false);
	});

	it("rejects non-finite timeout configuration", () => {
		expect(() => new FetchHttpTransport({ timeoutMs: 0 })).toThrow(/positive/);
		expect(() => new FetchHttpTransport({ timeoutMs: Number.NaN })).toThrow(/positive/);
		expect(() => new FetchHttpTransport({ timeoutMs: -5 })).toThrow(/positive/);
	});
});
