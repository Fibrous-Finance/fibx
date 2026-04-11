import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools, type ToolSummary } from "./tools/index.js";

declare const FIBX_VERSION: string;

const pkg = {
	name: "fibx",
	version:
		typeof FIBX_VERSION !== "undefined"
			? FIBX_VERSION
			: (createRequire(import.meta.url)("../../package.json") as { version: string }).version,
};

const MCP_INSTRUCTIONS = `fibx is a multi-chain EVM DeFi toolkit for Base, Citrea, HyperEVM, and Monad. You can:
- Check auth status and configure custom RPC URLs per chain
- Query native and ERC-20 token balances on any supported chain
- View cross-chain portfolio with USD values and Aave V3 DeFi positions
- Execute token swaps via Fibrous DEX aggregator with optimal routing
- Send native and ERC-20 tokens across chains
- Supply, borrow, repay, withdraw on Aave V3 (Base only)
- Monitor Aave V3 health factors and market rates (APY, TVL, LTV)

RULES:
1. Always call get_auth_status before wallet operations.
2. For swaps, swap_tokens handles approvals and wrap/unwrap automatically.
3. Aave V3 is ONLY available on Base — do NOT attempt Aave operations on other chains.
4. Use "max" as amount for full repay/withdraw on Aave.
5. Config tool manages custom RPC URLs to avoid rate limits.
6. All write tools are destructive — confirm with the user before executing.
7. Use simulate=true on transactional tools to preview fees before execution.
8. Always call get_aave_markets before Aave supply/borrow operations.
9. get_portfolio provides cross-chain overview including DeFi positions.`;

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

	const transport = new StdioServerTransport();
	await server.connect(transport);

	printBanner(summary);
}
