import { describe, expect, it } from "vitest";
import type { App } from "@modelcontextprotocol/ext-apps";
import { callJson } from "./rpc.js";

function fakeApp(result: unknown): App {
	return {
		callServerTool: async () => result,
	} as unknown as App;
}

function textResult(text: string, isError?: boolean) {
	return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

describe("callJson", () => {
	// This is the shape withErrorHandling (src/mcp/tools/error-handling.ts)
	// actually returns for a thrown error: a normal result, no isError, with
	// success:false in the JSON body. Before this fix callJson returned this
	// body cast as a success, and callers rendered a broken success value.
	it("rejects on a success:false body even without isError", async () => {
		const app = fakeApp(
			textResult(JSON.stringify({ success: false, error: "relay unreachable" }))
		);
		await expect(callJson(app, "connect_wallet")).rejects.toThrow("relay unreachable");
	});

	it("rejects with the message from a JSON error body when isError is set", async () => {
		const app = fakeApp(textResult(JSON.stringify({ error: "bad input" }), true));
		await expect(callJson(app, "connect_wallet")).rejects.toThrow("bad input");
	});

	it("rejects with the raw text when isError is set and the text is not JSON", async () => {
		const app = fakeApp(textResult("nope, not json", true));
		await expect(callJson(app, "connect_wallet")).rejects.toThrow("nope, not json");
	});

	it("resolves a normal body with no success field", async () => {
		const app = fakeApp(textResult(JSON.stringify({ uri: "wc:abc" })));
		await expect(callJson(app, "connect_wallet")).resolves.toEqual({ uri: "wc:abc" });
	});

	it("resolves a normal body with success:true", async () => {
		const app = fakeApp(textResult(JSON.stringify({ success: true, address: "0x1" })));
		await expect(callJson(app, "get_auth_status")).resolves.toEqual({
			success: true,
			address: "0x1",
		});
	});
});
