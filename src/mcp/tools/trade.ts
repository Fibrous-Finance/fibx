import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { handleSwapTokens } from "../handlers/trade.js";
import { handleGetQuote } from "../handlers/quote.js";
import { withErrorHandling } from "./error-handling.js";
import { ChainEnum } from "./schemas.js";
import { SWAP_CARD_URI } from "../ui.js";
import { DEFAULT_SLIPPAGE } from "../../lib/config.js";
import {
	MAX_SLIPPAGE_PERCENT,
	MIN_SLIPPAGE_PERCENT,
	slippageSchema,
} from "../../lib/validation.js";

/**
 * Slippage is bounded here because the model calls these tools directly and
 * never passes through the swap card. The bound itself lives in
 * `src/lib/validation.ts` and is shared with the CLI's `--slippage` flag,
 * which passes through neither the schema nor the card — see the comment
 * there for why nothing downstream can catch a bad value.
 *
 * This schema adds only the tool-facing parts: the default and the
 * description a model reads.
 */
const SlippagePercent = slippageSchema
	.default(DEFAULT_SLIPPAGE)
	.describe(
		`Slippage tolerance percentage (${MIN_SLIPPAGE_PERCENT}-${MAX_SLIPPAGE_PERCENT}, default: ${DEFAULT_SLIPPAGE})`
	);

export function registerTradeTools(server: McpServer): number {
	// get_quote is read-only (readOnlyHint: true below), so binding it to a
	// UI resource is safe — the card can only ever appear, never act, until a
	// click inside it calls swap_tokens. registerAppTool is the SDK's
	// convenience wrapper around server.registerTool; it only normalizes the
	// `_meta.ui.resourceUri` field, so every annotation below is unchanged.
	registerAppTool(
		server,
		"get_quote",
		{
			title: "Get Swap Quote",
			description:
				"Get a price quote for a token swap without authentication. Shows expected output amount, exchange rate, and route info. No wallet or session required — use this to check prices before committing to a swap. Supported chains: Base, HyperEVM, Monad. Returns both a readable summary and a `quote` object carrying the route's hops, the exact output, the slippage floor and a derived price impact — computed from the tokens' spot prices, not reported by the router, so treat it as an estimate.",
			inputSchema: {
				amount: z.string().describe("Amount to quote (e.g. '0.1', '100')"),
				from_token: z.string().describe("Source token symbol (e.g. 'ETH', 'USDC', 'MON')"),
				to_token: z.string().describe("Destination token symbol"),
				chain: ChainEnum.default("base").describe("Target blockchain network"),
				slippage: SlippagePercent,
			},
			annotations: {
				title: "Price Quote",
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
			_meta: { ui: { resourceUri: SWAP_CARD_URI } },
		},
		withErrorHandling(handleGetQuote)
	);

	server.registerTool(
		"swap_tokens",
		{
			title: "Swap Tokens via Fibrous",
			description:
				"Swap tokens using Fibrous aggregator for optimal routing. Handles ERC-20 approvals and wrap/unwrap automatically. Supported chains: Base, HyperEVM, Monad. Set simulate=true for a no-broadcast preview; a gas estimate is returned where it can be calculated safely.",
			inputSchema: {
				amount: z.string().describe("Amount to swap (e.g. '0.1', '100')"),
				from_token: z.string().describe("Source token symbol (e.g. 'ETH', 'USDC', 'MON')"),
				to_token: z.string().describe("Destination token symbol"),
				chain: ChainEnum.default("base").describe("Target blockchain network"),
				slippage: SlippagePercent,
				simulate: z
					.boolean()
					.optional()
					.describe(
						"Set true for a no-broadcast preview; gas estimates may be unavailable"
					),
			},
			annotations: {
				title: "Token Swap",
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		withErrorHandling(handleSwapTokens)
	);

	return 2;
}
