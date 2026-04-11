import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleSwapTokens } from "../handlers/trade.js";
import { withErrorHandling } from "./error-handling.js";

const ChainEnum = z.enum(["base", "citrea", "hyperevm", "monad"]);

export function registerTradeTools(server: McpServer): number {
	server.registerTool(
		"swap_tokens",
		{
			title: "Swap Tokens via Fibrous",
			description:
				"Swap tokens using Fibrous aggregator for optimal routing. Handles ERC-20 approvals and wrap/unwrap automatically. Simulates before executing. Supported chains: Base, Citrea, HyperEVM, Monad. Set simulate=true to estimate fees without executing.",
			inputSchema: {
				amount: z.string().describe("Amount to swap (e.g. '0.1', '100')"),
				from_token: z.string().describe("Source token symbol (e.g. 'ETH', 'USDC', 'MON')"),
				to_token: z.string().describe("Destination token symbol"),
				chain: ChainEnum.default("base").describe("Target blockchain network"),
				slippage: z
					.number()
					.default(0.5)
					.describe("Slippage tolerance percentage (default: 0.5)"),
				simulate: z
					.boolean()
					.optional()
					.describe(
						"Set true to simulate only — estimates fees without sending a transaction"
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

	return 1;
}
