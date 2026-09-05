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
			// The Telegram bot and every CLI agent see this tool too, and in
			// those hosts nobody sees an app. The description says which host
			// it is for — but it must NOT tell the model to prefer other tools
			// elsewhere: a model cannot tell whether its host renders UI, and
			// the first hands-on test showed it reading "prefer get_quote" as a
			// reason to skip the app in a host that does. The snapshot is
			// readable JSON in every host, so the honest sentence is that one.
			description:
				"Open the FibX app: wallet, balances, signing policy, and a swap form with the Fibrous route. In a host that renders MCP Apps UI this is the entry point for anything about the wallet, a balance, a quote, or a swap — it executes nothing; the user sees the app and presses Simulate and Swap themselves. Pass from/to/amount to open it pre-filled with a quote. Supported chains: Base, HyperEVM, Monad. If the host does not render UI, the result is still a complete JSON snapshot you can read and summarise.",
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
