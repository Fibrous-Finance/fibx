import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./index.js";
import { APP_URI } from "../ui.js";

type Registered = Record<string, { annotations?: Record<string, unknown>; _meta?: unknown }>;

function registry(): Registered {
	const server = new McpServer({ name: "t", version: "0" });
	registerTools(server);
	return (server as unknown as { _registeredTools: Registered })._registeredTools;
}

describe("the app tools", () => {
	// registerAppTool also mirrors the URI onto the deprecated `ui/resourceUri`
	// key for older hosts (see trade.test.ts) — asserting through
	// `ui.resourceUri` only, rather than the whole `_meta` object, keeps this
	// from breaking if that compatibility shim ever changes shape.
	it("binds open_fibx to the app resource, read-only", () => {
		const t = registry().open_fibx;
		expect((t._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri).toBe(APP_URI);
		expect(t.annotations?.readOnlyHint).toBe(true);
		expect(t.annotations?.destructiveHint).toBe(false);
	});

	it("registers list_tokens headless and read-only", () => {
		const t = registry().list_tokens;
		expect(t._meta).toBeUndefined();
		expect(t.annotations?.readOnlyHint).toBe(true);
	});

	// One tool, one app. Anything else bound to UI would produce a second
	// widget in the chat for the same turn.
	it("binds nothing else to a UI resource", () => {
		const bound = Object.entries(registry())
			.filter(([, t]) => t._meta !== undefined)
			.map(([name]) => name);
		expect(bound).toEqual(["open_fibx"]);
	});

	it("keeps swap_tokens destructive and unbound", () => {
		const t = registry().swap_tokens;
		expect(t._meta).toBeUndefined();
		expect(t.annotations?.readOnlyHint).toBe(false);
		expect(t.annotations?.destructiveHint).toBe(true);
	});
});
