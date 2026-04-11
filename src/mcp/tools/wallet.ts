import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	handleGetBalance,
	handleGetPortfolio,
	handleSendTokens,
	handleGetTxStatus,
} from "../handlers/wallet.js";
import { withErrorHandling } from "./error-handling.js";

const ChainEnum = z.enum(["base", "citrea", "hyperevm", "monad"]);

export function registerWalletTools(server: McpServer): number {
	server.registerTool(
		"get_balance",
		{
			title: "Get Wallet Balance",
			description:
				"Get native token and all ERC-20 token balances for the active wallet on a specific chain. Only returns tokens with non-zero balances.",
			inputSchema: {
				chain: ChainEnum.default("base").describe("Target blockchain network"),
			},
			annotations: {
				title: "Wallet Balance",
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: true,
			},
		},
		withErrorHandling(handleGetBalance)
	);

	server.registerTool(
		"send_tokens",
		{
			title: "Send Tokens",
			description:
				"Send native tokens (ETH, cBTC, HYPE, MON) or ERC-20 tokens to a recipient address. Simulates before executing. If token is omitted, the chain's native token is used. Set simulate=true to estimate fees without executing.",
			inputSchema: {
				amount: z.string().describe("Amount to send (e.g. '0.1', '100')"),
				recipient: z.string().describe("Recipient address (0x...)"),
				token: z
					.string()
					.optional()
					.describe("Token symbol (e.g. 'USDC', 'ETH'). Omit for native token transfer."),
				chain: ChainEnum.default("base").describe("Target blockchain network"),
				simulate: z
					.boolean()
					.optional()
					.describe(
						"Set true to simulate only — estimates fees without sending a transaction"
					),
			},
			annotations: {
				title: "Token Transfer",
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		withErrorHandling(handleSendTokens)
	);

	server.registerTool(
		"get_tx_status",
		{
			title: "Get Transaction Status",
			description:
				"Check the on-chain status and receipt of a transaction by its hash. Returns confirmation status, block number, gas used, and addresses.",
			inputSchema: {
				hash: z.string().describe("Transaction hash (0x...)"),
				chain: ChainEnum.default("base").describe("Chain the transaction was submitted on"),
			},
			annotations: {
				title: "Transaction Receipt",
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: true,
			},
		},
		withErrorHandling(handleGetTxStatus)
	);

	server.registerTool(
		"get_portfolio",
		{
			title: "Cross-Chain Portfolio",
			description:
				"Get a complete cross-chain portfolio overview with USD valuations for all token holdings across Base, Citrea, HyperEVM, and Monad. Includes DeFi positions (Aave V3). Returns total net worth.",
			inputSchema: {},
			annotations: {
				title: "Portfolio Overview",
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: true,
			},
		},
		withErrorHandling(handleGetPortfolio)
	);

	return 4;
}
