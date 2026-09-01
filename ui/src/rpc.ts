import type { App } from "@modelcontextprotocol/ext-apps";
import { parseToolJson } from "./status.js";

/**
 * Call a server tool and decode its JSON. A tool-level failure comes back as
 * `isError: true` with the reason in the text block; surface that reason as
 * the thrown message so every caller shows the same words the CLI would.
 */
export async function callJson<T>(
	app: App,
	name: string,
	args: Record<string, unknown> = {}
): Promise<T> {
	const result = await app.callServerTool({ name, arguments: args });
	if (result.isError) {
		let message = "Tool call failed";
		try {
			const body = parseToolJson<{ error?: string; message?: string }>(result);
			message = body.error ?? body.message ?? message;
		} catch {
			const text = result.content?.find((c) => c.type === "text")?.text;
			if (text) message = text;
		}
		throw new Error(message);
	}
	return parseToolJson<T>(result);
}
