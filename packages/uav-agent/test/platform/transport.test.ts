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
