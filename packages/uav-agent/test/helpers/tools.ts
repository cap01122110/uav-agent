/**
 * Shared helpers for exercising ToolDefinitions directly in unit tests,
 * bypassing the pi extension runtime.
 */
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Minimal ExtensionContext stub acceptable to ToolDefinition.execute. */
export function fakeExtensionContext(): ExtensionContext {
	return { sessionManager: { getSessionId: () => "s1" } } as unknown as ExtensionContext;
}

/** Text of the first content block, or throws when it is not text. */
export function firstText<T>(result: AgentToolResult<T>): string {
	const block = result.content[0];
	if (block === undefined || block.type !== "text") {
		throw new Error("expected the first content block to be text");
	}
	return block.text;
}
