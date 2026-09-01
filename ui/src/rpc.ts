import type { App } from "@modelcontextprotocol/ext-apps";
import { parseToolJson } from "./status.js";

type FailureBody = { success?: boolean; error?: string; message?: string; rawMessage?: string };

/**
 * Call a server tool and decode its JSON.
 *
 * This server's tools report failure two different ways, and both have to be
 * caught here or a caller sees a broken success value instead of an error:
 *
 * - `isError: true` — the SDK sets this only when a handler throws past its
 *   own catch, which in practice is essentially just zod input-validation.
 * - a normal (non-error) result whose JSON body is `{ success: false, error,
 *   code, rawMessage }` — `withErrorHandling` (src/mcp/tools/error-handling.ts)
 *   catches every thrown error and returns this shape with no `isError` at
 *   all. This is how most tool failures actually arrive (relay unreachable,
 *   bad project id, a policy refusal, …).
 *
 * A body with no `success` field at all is a normal success — most tools
 * never set it, so `success` is only ever checked for `=== false`, never
 * required to be `true`.
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
	const body = parseToolJson<FailureBody>(result);
	if (body.success === false) {
		throw new Error(body.error ?? body.message ?? body.rawMessage ?? "Tool call failed");
	}
	return body as T;
}
