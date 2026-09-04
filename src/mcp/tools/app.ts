import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { handleOpenFibx, handleListTokens } from "../handlers/app.js";
import { withErrorHandling } from "./error-handling.js";
import { ChainEnum } from "./schemas.js";
import { APP_URI } from "../ui.js";
import { slippageSchema } from "../../lib/validation.js";

export function registerAppTools(server: McpServer): number {
	// The ONLY tool bound to a ui:// resource. It is read-only: opening the app
	// changes nothing; every write happens from a click inside it.
	registerAppTool(
		server,
		"open_fibx",
		{
			title: "Open FibX",
			description:
				"Open the FibX app: wallet, balances, signing policy, and a swap form with the Fibrous route. Call this for anything about the wallet, a balance, a quote, or a swap — the user sees the app and acts from it. Pass from/to/amount to open it pre-filled with a quote. Supported chains: Base, HyperEVM, Monad.",
			inputSchema: {
				chain: ChainEnum.default("base").describe("Chain to open on"),
				from: z.string().optional().describe("Source token symbol, to pre-fill a swap"),
				to: z.string().optional().describe("Destination token symbol, to pre-fill a swap"),
				amount: z
					.string()
					.optional()
					.describe("Amount of the source token, to pre-fill a swap"),
				slippage: slippageSchema
					.optional()
					.describe("Slippage percent for the pre-filled quote"),
			},
			annotations: {
				title: "FibX App",
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
			_meta: { ui: { resourceUri: APP_URI } },
		},
		withErrorHandling(handleOpenFibx)
	);

	// Headless: only the app's token picker calls this.
	server.registerTool(
		"list_tokens",
		{
			title: "List Tokens",
			description:
				"List the tokens Fibrous supports on a chain, with symbol, name, address, decimals and USD price where known.",
			inputSchema: {
				chain: ChainEnum.default("base").describe("Chain to list tokens for"),
			},
			annotations: {
				title: "Token List",
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		withErrorHandling(handleListTokens)
	);

	return 2;
}
