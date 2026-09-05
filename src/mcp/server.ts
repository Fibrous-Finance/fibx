import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools, type ToolSummary } from "./tools/index.js";
import { registerApp } from "./ui.js";

declare const FIBX_VERSION: string;

const pkg = {
	name: "fibx",
	version:
		typeof FIBX_VERSION !== "undefined"
			? FIBX_VERSION
			: (createRequire(import.meta.url)("../../package.json") as { version: string }).version,
};

const MCP_INSTRUCTIONS = `fibx is a multi-chain EVM DeFi toolkit for Base, HyperEVM, and Monad. You can:
- Open the FibX app (open_fibx) — wallet, balances, signing policy and a swap form with the Fibrous route, rendered as MCP Apps UI where the host supports it
- Get price quotes without authentication (get_quote — no wallet needed)
- Check auth status and configure custom RPC URLs per chain
- Query native and ERC-20 token balances on any supported chain
- View cross-chain portfolio with USD values and Aave V3 DeFi positions
- Execute token swaps via Fibrous DEX aggregator with optimal routing
- Send native and ERC-20 tokens across chains
- Supply, borrow, repay, withdraw on Aave V3 (Base only)
- Monitor Aave V3 health factors and market rates (APY, TVL, LTV)

RULES:
1. If your host renders MCP Apps UI, open_fibx is the entry point for anything about the wallet, a balance, a quote or a swap. It executes nothing — it shows the user the FibX app, and the user presses Simulate and Swap themselves. Call it even when you would decline to execute a swap yourself: opening the app is not executing a trade. Pass from/to/amount to open it pre-filled. The rules below apply in a text-only host, or when you need a single value rather than the app.
2. get_quote, get_tx_status, and get_aave_markets do NOT require authentication; use get_quote for price checks and rate discovery.
3. In a text-only host, call get_auth_status before wallet/transactional operations.
4. For swaps, swap_tokens handles approvals and wrap/unwrap automatically.
5. Aave V3 is ONLY available on Base — do NOT attempt Aave operations on other chains.
6. Use "max" as amount for full repay/withdraw on Aave.
7. Config tool manages custom RPC URLs to avoid rate limits.
8. All write tools are destructive — confirm with the user before executing.
9. Use simulate=true on transactional tools for a no-broadcast preview; gas estimates are returned only where available.
10. Always call get_aave_markets before Aave supply/borrow operations.
11. get_portfolio provides cross-chain overview including DeFi positions.
12. A local signing policy may refuse a transaction regardless of which tool sent it — get_policy explains what is set, and a refusal names the rule that blocked it.`;

function printBanner(summary: ToolSummary): void {
	const version = pkg.version;
	const line = "═".repeat(49);
	const maxNameLen = Math.max(...summary.categories.map((c) => c.name.length));

	const lines = [
		"",
		`  ${line}`,
		`   FibX MCP Server v${version}`,
		`   Transport: stdio`,
		`  ${line}`,
		"",
		`   Tools (${summary.total}):`,
		...summary.categories.map((c) => {
			const dots = "·".repeat(maxNameLen - c.name.length + 4);
			return `     ${c.name} ${dots} ${c.count} tools`;
		}),
		"",
		`   ✓ Server ready — awaiting client connection`,
		`  ${line}`,
		"",
	];

	// MCP stdio transport reserves stdout for JSON-RPC.
	// All human-readable output MUST go to stderr.
	process.stderr.write(lines.join("\n") + "\n");
}

export async function startMcpServer(): Promise<void> {
	const server = new McpServer(
		{
			name: pkg.name,
			version: pkg.version,
		},
		{
			instructions: MCP_INSTRUCTIONS,
			capabilities: { logging: {} },
		}
	);

	const summary = registerTools(server);
	registerApp(server);

	const transport = new StdioServerTransport();
	await server.connect(transport);

	printBanner(summary);
}
