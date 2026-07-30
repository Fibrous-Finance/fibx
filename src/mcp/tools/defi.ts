import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleGetAaveStatus, handleGetAaveMarkets, handleAaveAction } from "../handlers/defi.js";
import { withErrorHandling } from "./error-handling.js";

export function registerDefiTools(server: McpServer): number {
	server.registerTool(
		"get_aave_status",
		{
			title: "Aave V3 Account Status",
			description:
				"Get Aave V3 position health on Base: health factor, total collateral, total debt, and available borrows in USD.",
			inputSchema: {},
			annotations: {
				title: "Aave V3 Position",
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: true,
			},
		},
		withErrorHandling(handleGetAaveStatus)
	);

	server.registerTool(
		"get_aave_markets",
		{
			title: "Aave V3 Markets",
			description:
				"List all Aave V3 reserve markets on Base with supply/borrow APY, total supply, total borrow, and LTV. Always call this before Aave supply/borrow operations. No wallet required.",
			inputSchema: {},
			annotations: {
				title: "Aave V3 Markets",
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: true,
			},
		},
		withErrorHandling(handleGetAaveMarkets)
	);

	server.registerTool(
		"aave_action",
		{
			title: "Aave V3 Action",
			description:
				"Execute an Aave V3 action on Base: supply, borrow, repay, or withdraw. ETH supply/repay can auto-wrap and ETH withdraw can auto-unwrap; borrowing the ETH market returns WETH. Use 'max' as amount to repay or withdraw the full balance. Set simulate=true for a no-broadcast operation preview.",
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
				simulate: z
					.boolean()
					.optional()
					.describe("Set true for a no-broadcast operation preview"),
			},
			annotations: {
				title: "Aave V3 Operation",
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		withErrorHandling(handleAaveAction)
	);

	return 3;
}
