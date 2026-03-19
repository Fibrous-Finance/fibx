import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	handleGetBalance,
	handleSwapTokens,
	handleSendTokens,
	handleGetTxStatus,
	handleGetAaveStatus,
	handleGetAaveMarkets,
	handleAaveAction,
	handleGetAuthStatus,
	handleConfigAction,
	handleGetPortfolio,
} from "./handlers.js";

const ChainEnum = z.enum(["base", "citrea", "hyperevm", "monad"]);

function toStructured(obj: object): { [x: string]: unknown } {
	return { ...obj } as { [x: string]: unknown };
}

async function safeToolCall<T extends object>(
	fn: () => Promise<T>
): Promise<{
	content: { type: "text"; text: string }[];
	structuredContent?: { [x: string]: unknown };
	isError?: boolean;
}> {
	try {
		const output = await fn();
		return {
			content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
			structuredContent: toStructured(output),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text" as const, text: `Error: ${message}` }],
			isError: true,
		};
	}
}

export function registerAllTools(server: McpServer): void {
	server.registerTool(
		"get_auth_status",
		{
			title: "Check Auth & Fibrous Status",
			description:
				"Check authentication status and Fibrous API health. Always call this first to verify the session is active before performing any transaction.",
			inputSchema: {
				chain: ChainEnum.default("base").describe(
					"Target chain to check Fibrous health for"
				),
			},
			outputSchema: {
				authenticated: z.boolean(),
				walletAddress: z.string().nullable(),
				sessionType: z.string().nullable(),
				chain: z.string(),
				fibrousStatus: z.string(),
			},
			annotations: {
				title: "Auth & Health Check",
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: true,
			},
		},
		async ({ chain }) => safeToolCall(() => handleGetAuthStatus(chain))
	);

	server.registerTool(
		"get_balance",
		{
			title: "Get Wallet Balance",
			description:
				"Get native token and all ERC-20 token balances for the active wallet on a specific chain. Only returns tokens with non-zero balances.",
			inputSchema: {
				chain: ChainEnum.default("base").describe("Target blockchain network"),
			},
			outputSchema: {
				wallet: z.string(),
				chain: z.string(),
				balances: z.record(z.string(), z.string()),
			},
			annotations: {
				title: "Wallet Balance",
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: true,
			},
		},
		async ({ chain }) => safeToolCall(() => handleGetBalance(chain))
	);

	server.registerTool(
		"swap_tokens",
		{
			title: "Swap Tokens via Fibrous",
			description:
				"Swap tokens using Fibrous aggregator for optimal routing. Handles ERC-20 approvals and wrap/unwrap automatically. Simulates before executing. Supported chains: Base, Citrea, HyperEVM, Monad.",
			inputSchema: {
				amount: z.string().describe("Amount to swap (e.g. '0.1', '100')"),
				from_token: z.string().describe("Source token symbol (e.g. 'ETH', 'USDC', 'MON')"),
				to_token: z.string().describe("Destination token symbol"),
				chain: ChainEnum.default("base").describe("Target blockchain network"),
				slippage: z
					.number()
					.default(0.5)
					.describe("Slippage tolerance percentage (default: 0.5)"),
			},
			outputSchema: {
				txHash: z.string(),
				amountIn: z.string(),
				amountOut: z.string(),
				tokenIn: z.string(),
				tokenOut: z.string(),
				router: z.string(),
				chain: z.string(),
			},
			annotations: {
				title: "Token Swap",
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async ({ amount, from_token, to_token, chain, slippage }) =>
			safeToolCall(() => handleSwapTokens(amount, from_token, to_token, chain, slippage))
	);

	server.registerTool(
		"send_tokens",
		{
			title: "Send Tokens",
			description:
				"Send native tokens (ETH, cBTC, HYPE, MON) or ERC-20 tokens to a recipient address. Simulates before executing. If token is omitted, the chain's native token is used.",
			inputSchema: {
				amount: z.string().describe("Amount to send (e.g. '0.1', '100')"),
				recipient: z.string().describe("Recipient address (0x...)"),
				token: z
					.string()
					.optional()
					.describe("Token symbol (e.g. 'USDC', 'ETH'). Omit for native token transfer."),
				chain: ChainEnum.default("base").describe("Target blockchain network"),
			},
			outputSchema: {
				txHash: z.string(),
				amount: z.string(),
				token: z.string(),
				recipient: z.string(),
				chain: z.string(),
			},
			annotations: {
				title: "Token Transfer",
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async ({ amount, recipient, token, chain }) =>
			safeToolCall(() => handleSendTokens(amount, recipient, token, chain))
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
			outputSchema: {
				hash: z.string(),
				status: z.string(),
				blockNumber: z.string().nullable(),
				from: z.string(),
				to: z.string().nullable(),
				gasUsed: z.string().nullable(),
				chain: z.string(),
			},
			annotations: {
				title: "Transaction Receipt",
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: true,
			},
		},
		async ({ hash, chain }) => safeToolCall(() => handleGetTxStatus(hash, chain))
	);

	server.registerTool(
		"get_aave_status",
		{
			title: "Aave V3 Account Status",
			description:
				"Get Aave V3 position health on Base: health factor, total collateral, total debt, and available borrows in USD.",
			inputSchema: {},
			outputSchema: {
				wallet: z.string(),
				healthFactor: z.string(),
				totalCollateralUSD: z.string(),
				totalDebtUSD: z.string(),
				availableBorrowsUSD: z.string(),
			},
			annotations: {
				title: "Aave V3 Position",
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: true,
			},
		},
		async () => safeToolCall(() => handleGetAaveStatus())
	);

	server.registerTool(
		"get_aave_markets",
		{
			title: "Aave V3 Markets",
			description:
				"List all Aave V3 reserve markets on Base with supply/borrow APY, total supply, total borrow, and LTV. No wallet required.",
			inputSchema: {},
			annotations: {
				title: "Aave V3 Markets",
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: true,
			},
		},
		async () => safeToolCall(() => handleGetAaveMarkets())
	);

	server.registerTool(
		"aave_action",
		{
			title: "Aave V3 Action",
			description:
				"Execute an Aave V3 action on Base: supply, borrow, repay, or withdraw. Auto-handles ETH<->WETH wrapping/unwrapping. Use 'max' as amount to repay or withdraw the full balance.",
			inputSchema: {
				action: z
					.enum(["supply", "borrow", "repay", "withdraw"])
					.describe("Aave action to perform"),
				amount: z
					.string()
					.describe(
						"Amount (e.g. '100', '0.5', 'max'). Use 'max' for full repay/withdraw."
					),
				token: z.string().describe("Token symbol (e.g. 'ETH', 'USDC', 'WETH')"),
			},
			outputSchema: {
				action: z.string(),
				amount: z.string(),
				token: z.string(),
				txHash: z.string(),
				chain: z.string(),
			},
			annotations: {
				title: "Aave V3 Operation",
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async ({ action, amount, token }) =>
			safeToolCall(() => handleAaveAction(action, amount, token))
	);

	server.registerTool(
		"config_action",
		{
			title: "Manage RPC Configuration",
			description:
				"View and modify fibx RPC configuration. Use 'set-rpc' to set a custom RPC URL for a chain (helps avoid rate limits), 'get-rpc' to view the current RPC for a chain, 'reset-rpc' to reset a chain's RPC to default (omit chain to reset all), or 'list' to show all custom RPC settings.",
			inputSchema: {
				action: z
					.enum(["set-rpc", "get-rpc", "reset-rpc", "list"])
					.describe("Config action to perform"),
				chain: ChainEnum.optional().describe(
					"Target chain (required for set-rpc and get-rpc)"
				),
				url: z.string().optional().describe("RPC URL to set (required for set-rpc)"),
			},
			annotations: {
				title: "RPC Configuration",
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ action, chain, url }) => safeToolCall(() => handleConfigAction(action, chain, url))
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
		async () => safeToolCall(() => handleGetPortfolio())
	);
}
