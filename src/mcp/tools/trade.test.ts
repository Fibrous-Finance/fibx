import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTradeTools } from "./trade.js";
import { SWAP_CARD_URI } from "../ui.js";

/**
 * registerAppTool (@modelcontextprotocol/ext-apps/server) is a thin wrapper
 * around server.registerTool that normalizes `_meta.ui.resourceUri` — it
 * still ends up in the same private `_registeredTools` registry
 * annotations.test.ts already reads, so this uses the identical accessor
 * rather than re-deriving anything from source.
 */
function registeredTool(
	server: McpServer,
	name: string
): { annotations?: Record<string, unknown>; _meta?: Record<string, unknown> } {
	const registry = (
		server as unknown as {
			_registeredTools: Record<
				string,
				{ annotations?: Record<string, unknown>; _meta?: Record<string, unknown> }
			>;
		}
	)._registeredTools;
	const tool = registry[name];
	if (!tool) throw new Error(`Tool "${name}" was not registered.`);
	return tool;
}

describe("get_quote is bound to the swap card", () => {
	const server = new McpServer({ name: "fibx-test", version: "0.0.0" });
	registerTradeTools(server);

	// The card's whole safety argument rests on get_quote staying read-only —
	// a card must never be able to move money merely by appearing.
	it("stays read-only and non-destructive", () => {
		const tool = registeredTool(server, "get_quote");
		expect(tool.annotations?.readOnlyHint).toBe(true);
		expect(tool.annotations?.destructiveHint).toBe(false);
	});

	// registerAppTool also mirrors the URI onto the deprecated
	// `ui/resourceUri` key for older hosts — asserting through `ui.resourceUri`
	// only, rather than the whole `_meta` object, keeps this from breaking if
	// that compatibility shim ever changes shape.
	it("carries the swap card's resource URI", () => {
		const tool = registeredTool(server, "get_quote");
		expect((tool._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri).toBe(
			SWAP_CARD_URI
		);
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
