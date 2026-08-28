import { describe, expect, it } from "vitest";
import { PlatformError } from "../../src/platform/errors.ts";
import {
	collectPagedList,
	iteratePagedList,
	MAX_PAGES,
	type PagedListPayload,
	requirePagedList,
} from "../../src/platform/pagination.ts";

function payload(items: unknown[], page: number, pageSize: number, total: number): PagedListPayload {
	return { items, pagination: { page, pageSize, total } };
}

function expectInvalidResponse(run: () => unknown): void {
	try {
		run();
		expect.unreachable();
	} catch (error) {
		expect((error as PlatformError).code).toBe("INVALID_RESPONSE");
	}
}

describe("requirePagedList", () => {
	it("accepts a valid list payload and normalizes pagination", () => {
		const data = { list: [1, 2], pagination: { page: 1, page_size: 2, total: 2 } };
		expect(requirePagedList(data, "jobList")).toEqual(payload([1, 2], 1, 2, 2));
	});

	it("rejects non-record data, missing list and missing pagination", () => {
		expectInvalidResponse(() => requirePagedList(undefined, "jobList"));
		expectInvalidResponse(() => requirePagedList(null, "jobList"));
		expectInvalidResponse(() => requirePagedList([], "jobList"));
		expectInvalidResponse(() => requirePagedList({}, "jobList"));
		expectInvalidResponse(() => requirePagedList({ list: [] }, "jobList"));
		expectInvalidResponse(() => requirePagedList({ list: [], pagination: null }, "jobList"));
	});

	it("rejects illegal pagination values", () => {
		const base = { list: [] };
		expectInvalidResponse(() =>
			requirePagedList({ ...base, pagination: { page: 0, page_size: 1, total: 0 } }, "jobList"),
		);
		expectInvalidResponse(() =>
			requirePagedList({ ...base, pagination: { page: 1, page_size: 0, total: 0 } }, "jobList"),
		);
		expectInvalidResponse(() =>
			requirePagedList({ ...base, pagination: { page: 1, page_size: 1, total: -1 } }, "jobList"),
		);
		expectInvalidResponse(() =>
			requirePagedList({ ...base, pagination: { page: 1.5, page_size: 1, total: 0 } }, "jobList"),
		);
		expectInvalidResponse(() =>
			requirePagedList({ ...base, pagination: { page: "1", page_size: 1, total: 0 } }, "jobList"),
		);
	});
});

describe("iteratePagedList", () => {
	it("visits every page in order and completes via pagination", async () => {
		const seen: unknown[] = [];
		const pages = [payload(["a", "b"], 1, 2, 3), payload(["c"], 2, 2, 3)];
		const stoppedEarly = await iteratePagedList(
			"jobList",
			(page) => Promise.resolve(pages[page - 1]!),
			(item) => {
				seen.push(item);
				return false;
			},
		);
		expect(stoppedEarly).toBe(false);
		expect(seen).toEqual(["a", "b", "c"]);
	});

	it("stops early when the visitor finds a match", async () => {
		const pages = [payload(["a", "b"], 1, 2, 4), payload(["c"], 2, 2, 4)];
		let requested = 0;
		const stoppedEarly = await iteratePagedList(
			"jobList",
			(page) => {
				requested = page;
				return Promise.resolve(pages[page - 1]!);
			},
			(item) => item === "b",
		);
		expect(stoppedEarly).toBe(true);
		expect(requested).toBe(1);
	});

	it("propagates loader failures instead of reporting a complete scan", async () => {
		const loader = () =>
			Promise.reject(new PlatformError({ code: "UPSTREAM_TIMEOUT", message: "t", retryable: true }));
		await expect(iteratePagedList("jobList", loader, () => false)).rejects.toMatchObject({
			code: "UPSTREAM_TIMEOUT",
		});
	});

	it("rejects a page other than the requested one", async () => {
		const loader = () => Promise.resolve(payload([], 2, 1, 0));
		await expect(iteratePagedList("jobList", loader, () => false)).rejects.toMatchObject({
			code: "INVALID_RESPONSE",
		});
	});

	it("rejects a page returning more items than page_size", async () => {
		const loader = () => Promise.resolve(payload(["a", "b", "c"], 1, 2, 3));
		await expect(iteratePagedList("jobList", loader, () => false)).rejects.toMatchObject({
			code: "INVALID_RESPONSE",
		});
	});

	it("rejects when total contradicts the rows read (short non-final page)", async () => {
		const loader = () => Promise.resolve(payload(["a"], 1, 2, 2));
		await expect(iteratePagedList("jobList", loader, () => false)).rejects.toMatchObject({
			code: "INVALID_RESPONSE",
		});
	});

	it("rejects a scan exceeding MAX_PAGES", async () => {
		// Every page is full and total always claims another page exists.
		const loader = (page: number) => Promise.resolve(payload(["x"], page, 1, MAX_PAGES + 10));
		await expect(iteratePagedList("jobList", loader, () => false)).rejects.toMatchObject({
			code: "INVALID_RESPONSE",
		});
	});
});

describe("collectPagedList", () => {
	it("collects all items across pages", async () => {
		const pages = [payload(["a"], 1, 1, 2), payload(["b"], 2, 1, 2)];
		const items = await collectPagedList("dockList", (page) => Promise.resolve(pages[page - 1]!));
		expect(items).toEqual(["a", "b"]);
	});

	it("throws on an inconsistent scan instead of returning partial data", async () => {
		const pages = [payload(["a"], 1, 1, 2), payload([], 2, 1, 2)];
		await expect(collectPagedList("dockList", (page) => Promise.resolve(pages[page - 1]!))).rejects.toMatchObject({
			code: "INVALID_RESPONSE",
		});
	});
});
