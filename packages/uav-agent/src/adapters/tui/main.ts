/**
 * UAV Agent TUI entry point.
 *
 * Composition root: builds the platform client from environment variables,
 * registers UAV tools, creates the pi-backed session factory, the UAV runtime,
 * and the TUI adapter, then runs until the user quits.
 *
 * Required environment:
 *   UAV_PLATFORM_URL, UAV_AGENT_CLIENT_ID, UAV_AGENT_CLIENT_SECRET, UAV_WORKSPACE_ID
 *
 * Launch with: npm run uav
 */

import { PiSessionFactory } from "../../backend/pi-session-factory.ts";
import { UavAgentRuntimeImpl } from "../../core/runtime.ts";
import type { UavPlatformClient } from "../../platform/client.ts";
import { createPlatformClientFromEnv } from "../../platform/config.ts";
import { createUavTools } from "../../tools/index.ts";
import { TuiAdapter } from "./tui-adapter.ts";

interface CliOptions {
	sessionId: string;
	title: string;
}

function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = { sessionId: "local-default", title: "UAV Agent" };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--session":
			case "-s": {
				const value = args[i + 1];
				if (value !== undefined) {
					options.sessionId = value;
					i++;
				}
				break;
			}
			case "--title": {
				const value = args[i + 1];
				if (value !== undefined) {
					options.title = value;
					i++;
				}
				break;
			}
			case "--help":
			case "-h":
				console.log(`Usage: uav [--session <id>] [--title <text>]`);
				process.exit(0);
				break;
			default:
				break;
		}
	}
	return options;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const options = parseArgs(argv);

	let platform: UavPlatformClient;
	try {
		platform = createPlatformClientFromEnv();
	} catch (error) {
		console.error(
			`Platform configuration error: ${error instanceof Error ? error.message : String(error)}. ` +
				"Set UAV_PLATFORM_URL and credentials in the environment.",
		);
		process.exit(1);
	}

	let runtime: UavAgentRuntimeImpl;
	const factory = new PiSessionFactory({
		customTools: createUavTools(platform, {
			prepareAction: (sessionId, input) => runtime.prepareAction(sessionId, input),
		}),
	});
	runtime = new UavAgentRuntimeImpl({ factory });

	try {
		await runtime.createSession({ sessionId: options.sessionId, userId: "local-user", channel: "tui" });
	} catch (error) {
		console.error(
			`Failed to start session: ${error instanceof Error ? error.message : String(error)}. ` +
				"Check that a model is configured (pi auth / model setup).",
		);
		await runtime.close();
		process.exit(1);
	}

	const adapter = new TuiAdapter({ runtime, sessionId: options.sessionId, title: options.title });
	await adapter.run();
	await runtime.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
	void main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
