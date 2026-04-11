import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAuthAndConfigTools } from "./auth.js";
import { registerWalletTools } from "./wallet.js";
import { registerTradeTools } from "./trade.js";
import { registerDefiTools } from "./defi.js";

export interface ToolCategory {
	name: string;
	count: number;
}

export interface ToolSummary {
	total: number;
	categories: ToolCategory[];
}

export function registerTools(server: McpServer): ToolSummary {
	const categories: ToolCategory[] = [
		{ name: "Auth & Config", count: registerAuthAndConfigTools(server) },
		{ name: "Wallet & Portfolio", count: registerWalletTools(server) },
		{ name: "Trading", count: registerTradeTools(server) },
		{ name: "DeFi (Aave V3)", count: registerDefiTools(server) },
	];

	return {
		total: categories.reduce((sum, c) => sum + c.count, 0),
		categories,
	};
}
