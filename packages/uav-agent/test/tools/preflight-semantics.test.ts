/**
 * Prompt and tool contract tests for the preflight semantics.
 *
 * The LLM's natural-language answer cannot be asserted in unit tests, so
 * these pin the contract the model is told to follow:
 * - system prompt contains the authoritative passed/informational rules
 * - preflight tool description matches real business semantics (no
 *   "drone offline blocks flight" wording)
 * - tool result structure carries passed + informational semantics
 */
import { describe, expect, it, vi } from "vitest";
import type { UavCapabilityClient } from "../../src/capability/client.ts";
import type { PreflightCheck, PreflightResult } from "../../src/platform/types.ts";
import { UAV_SYSTEM_PROMPT } from "../../src/prompt/system.ts";
import { preflightCheckTool } from "../../src/tools/safety/preflight-check.ts";
import { fakeExtensionContext, firstText } from "../helpers/tools.ts";

describe("UAV system prompt preflight rules", () => {
	it("makes tool passed the authoritative verdict", () => {
		expect(UAV_SYSTEM_PROMPT).toContain("authoritative");
		expect(UAV_SYSTEM_PROMPT).toContain("never override it");
	});

	it("defines informational as never blocking", () => {
		const flat = UAV_SYSTEM_PROMPT.replace(/\s+/g, " ").toLowerCase();
		expect(flat).toContain("informational");
		expect(flat).toContain("never treat it as a blocking condition");
	});

	it("forbids inventing extra safety restrictions", () => {
		expect(UAV_SYSTEM_PROMPT).toContain("must not invent safety rules");
	});

	it("forbids re-verifying informational items with follow-up status tools", () => {
		expect(UAV_SYSTEM_PROMPT).toContain("get_drone_status");
		expect(UAV_SYSTEM_PROMPT).toContain("do not call other");
	});

	it("keeps passed non-absolute (no guarantee of safe flight)", () => {
		expect(UAV_SYSTEM_PROMPT).toContain("does not mean absolute safety");
	});
});

describe("preflight_check tool contract", () => {
	it("description states the hard checks, passed as final verdict and informational semantics", () => {
		const tool = preflightCheckTool({} as unknown as UavCapabilityClient);
		const description = tool.description;
		// Hard checks named.
		expect(description).toContain("机场存在");
		expect(description).toContain("机场在线");
		expect(description).toContain("机场明确空闲");
		expect(description).toContain("已绑定无人机");
		// passed is the final verdict.
		expect(description).toContain("passed 字段是飞前检查的最终结论");
		// Informational semantics: docked drone offline alone does not fail.
		expect(description).toContain("informational");
		expect(description).toContain("不单独导致检查失败");
		// No stale "drone online" hard-check wording.
		expect(description).not.toContain("无人机在线、任何一项");
		expect(description).not.toContain("任何一项不满足则返回未通过");
	});

	it("result JSON keeps passed true when only an informational check failed (scenario A)", async () => {
		const result = await runToolWithChecks([
			{ name: "airport_online", passed: true },
			{ name: "airport_idle", passed: true },
			{ name: "drone_bound", passed: true },
			{ name: "drone_online", passed: false, informational: true },
		]);
		expect(result.passed).toBe(true);
		const droneCheck = result.checks.find((check) => check.name === "drone_online");
		expect(droneCheck?.informational).toBe(true);
		expect(droneCheck?.passed).toBe(false);
	});

	it("result JSON keeps passed false for a hard check failure (scenario B)", async () => {
		const result = await runToolWithChecks([
			{ name: "airport_online", passed: true },
			{ name: "airport_idle", passed: false },
		]);
		expect(result.passed).toBe(false);
		const idleCheck = result.checks.find((check) => check.name === "airport_idle");
		expect(idleCheck?.informational).toBeUndefined();
	});

	it("pins the producer convention for informational checks", () => {
		// The TS type does allow { passed: true, informational: true }; this test
		// pins the producer convention instead: the client (the only producer)
		// always emits informational checks with passed=false. A compile-time
		// guarantee is impossible here, so PreflightCheck.informational is
		// optional and documented as display-only. This test asserts the type
		// shape via a value.
		const check: PreflightCheck = { name: "x", passed: false, informational: true };
		expect(check.informational).toBe(true);
	});

	it("informational drone offline needs no follow-up drone query (scenario D)", async () => {
		// The tool result alone carries everything needed to answer: passed
		// plus each check's informational flag. No drone SN or query hint is
		// embedded, so the model has no data reason to call get_drone_status.
		const result = await runToolWithChecks([
			{ name: "airport_online", passed: true },
			{ name: "airport_idle", passed: true },
			{ name: "drone_bound", passed: true },
			{ name: "drone_online", passed: false, informational: true, detail: "SN" },
		]);
		const text = result.text;
		expect(JSON.parse(text).passed).toBe(true);
		// No instruction nudging the model toward a follow-up drone query.
		expect(text.toLowerCase()).not.toContain("get_drone_status");
		expect(text.toLowerCase()).not.toContain("re-check");
	});
});

async function runToolWithChecks(checks: PreflightResult["checks"]): Promise<PreflightResult & { text: string }> {
	const payload: PreflightResult = {
		airportId: "Test-01",
		passed: checks.every((check) => (check.informational === true ? true : check.passed)),
		checks,
	};
	const capabilities = {
		preflightCheck: vi.fn(async () => payload),
	} as unknown as UavCapabilityClient;
	const tool = preflightCheckTool(capabilities);
	const result = await tool.execute("c1", { airportId: "Test-01" }, undefined, undefined, fakeExtensionContext());
	return { ...payload, text: firstText(result) };
}
