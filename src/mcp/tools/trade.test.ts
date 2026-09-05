import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTradeTools } from "./trade.js";

/**
 * `_registeredTools` is the same private field annotations.test.ts already
 * reads, so this uses the identical accessor rather than re-deriving anything
 * from source.
 */
type RegisteredTool = {
	annotations?: Record<string, unknown>;
	_meta?: Record<string, unknown>;
	// The SDK stores the raw shape back as a zod object (_createRegisteredTool
	// in @modelcontextprotocol/sdk/server/mcp.js), which is what it parses
	// every incoming tool call against — so parsing through it here is the
	// same gate a real call meets, not a re-derivation of one.
	inputSchema?: { safeParse: (value: unknown) => { success: boolean } };
};

function registeredTool(server: McpServer, name: string): RegisteredTool {
	const registry = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
		._registeredTools;
	const tool = registry[name];
	if (!tool) throw new Error(`Tool "${name}" was not registered.`);
	return tool;
}

function parseArgs(server: McpServer, name: string, args: Record<string, unknown>): boolean {
	const schema = registeredTool(server, name).inputSchema;
	if (!schema) throw new Error(`Tool "${name}" registered no input schema.`);
	return schema.safeParse({ amount: "1", from_token: "ETH", to_token: "USDC", ...args }).success;
}

// get_quote used to be a bound tool of its own; open_fibx (src/mcp/tools/
// app.ts) is now the only tool bound to a ui:// resource, composing this same
// handler into its snapshot. get_quote itself goes back to headless, same as
// swap_tokens below.
describe("get_quote is headless — open_fibx is the bound tool now", () => {
	const server = new McpServer({ name: "fibx-test", version: "0.0.0" });
	registerTradeTools(server);

	// Still read-only and non-destructive: a model calling it directly, or
	// open_fibx composing it into the snapshot, must never move money merely
	// by asking for a price.
	it("stays read-only and non-destructive", () => {
		const tool = registeredTool(server, "get_quote");
		expect(tool.annotations?.readOnlyHint).toBe(true);
		expect(tool.annotations?.destructiveHint).toBe(false);
	});

	it("carries no ui.resourceUri", () => {
		const tool = registeredTool(server, "get_quote");
		expect(tool._meta).toBeUndefined();
	});
});

describe("swap_tokens is never bound to a UI resource", () => {
	const server = new McpServer({ name: "fibx-test", version: "0.0.0" });
	registerTradeTools(server);

	// A card must never be bound to a tool that moves money by appearing.
	// swap_tokens stays destructive and carries no _meta.ui at all — a card
	// only ever calls it from a click, never by being rendered.
	it("keeps its destructive annotations", () => {
		const tool = registeredTool(server, "swap_tokens");
		expect(tool.annotations?.readOnlyHint).toBe(false);
		expect(tool.annotations?.destructiveHint).toBe(true);
	});

	it("carries no ui.resourceUri", () => {
		const tool = registeredTool(server, "swap_tokens");
		expect(tool._meta).toBeUndefined();
	});
});

// A limit in the app's swap form alone is bypassable: the model calls these
// schemas directly and never passes through the form. swap_tokens derives the
// on-chain min_received from this number, and the local signing policy cannot
// catch a bad one either — maxValue bounds native value only, so an ERC-20 swap
// reaches the router with value: 0n and the cap never sees the amount.
describe("slippage is bounded by the schema, not only by the form", () => {
	const server = new McpServer({ name: "fibx-test", version: "0.0.0" });
	registerTradeTools(server);

	it.each(["get_quote", "swap_tokens"])("%s still takes an ordinary slippage", (name) => {
		expect(parseArgs(server, name, { slippage: 0.5 })).toBe(true);
	});

	it.each(["get_quote", "swap_tokens"])("%s still defaults slippage when omitted", (name) => {
		expect(parseArgs(server, name, {})).toBe(true);
	});

	it.each(["get_quote", "swap_tokens"])("%s refuses a slippage past the ceiling", (name) => {
		expect(parseArgs(server, name, { slippage: 50.1 })).toBe(false);
		expect(parseArgs(server, name, { slippage: 100 })).toBe(false);
	});

	it.each(["get_quote", "swap_tokens"])("%s refuses a zero or negative slippage", (name) => {
		expect(parseArgs(server, name, { slippage: 0 })).toBe(false);
		expect(parseArgs(server, name, { slippage: -1 })).toBe(false);
	});
});
