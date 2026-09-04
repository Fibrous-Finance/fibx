import type { App } from "@modelcontextprotocol/ext-apps";
import { parseToolJson } from "./status.js";

type FailureBody = {
	success?: boolean;
	error?: string;
	message?: string;
	rawMessage?: string;
	code?: string;
	details?: unknown;
};

/**
 * A tool call that failed, with what withErrorHandling
 * (src/mcp/tools/error-handling.ts) put in the body: the parsed message, the
 * FibxError code where there was one, and the raw message for the disclosure.
 */
export class ToolError extends Error {
	constructor(
		message: string,
		public readonly code: string | undefined,
		public readonly raw: string | undefined,
		public readonly details: unknown
	) {
		super(message);
		this.name = "ToolError";
	}
}

/**
 * Call a server tool and decode its JSON.
 *
 * This server's tools report failure two different ways, and both have to be
 * caught here or a caller sees a broken success value instead of an error:
 *
 * - `isError: true` — the SDK sets this only when a handler throws past its
 *   own catch, which in practice is essentially just zod input-validation.
 * - a normal (non-error) result whose JSON body is `{ success: false, error,
 *   code, rawMessage }` — withErrorHandling catches every thrown error and
 *   returns this shape with no `isError` at all. This is how most tool
 *   failures actually arrive.
 */
export async function callJson<T>(
	app: App,
	name: string,
	args: Record<string, unknown> = {}
): Promise<T> {
	const result = await app.callServerTool({ name, arguments: args });
	if (result.isError) {
		let body: FailureBody = {};
		try {
			body = parseToolJson<FailureBody>(result);
		} catch {
			const text = result.content?.find((c) => c.type === "text")?.text;
			body = { message: text };
		}
		throw new ToolError(
			body.error ?? body.message ?? "Tool call failed",
			body.code,
			body.rawMessage,
			body.details
		);
	}
	const body = parseToolJson<FailureBody>(result);
	if (body.success === false) {
		throw new ToolError(
			body.error ?? body.message ?? body.rawMessage ?? "Tool call failed",
			body.code,
			body.rawMessage,
			body.details
		);
	}
	return body as T;
}
