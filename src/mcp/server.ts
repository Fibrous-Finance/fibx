import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

export async function startMcpServer(): Promise<void> {
	const server = new McpServer({
		name: "fibx",
		version,
	});

	registerAllTools(server);

	const transport = new StdioServerTransport();
	await server.connect(transport);

	// stdout reserved for JSON-RPC
	console.error(`[mcp] fibx v${version} running on stdio`);
	console.error("   Tools: get_auth_status, get_balance, get_portfolio, swap_tokens,");
	console.error("          send_tokens, get_tx_status, get_aave_status, get_aave_markets,");
	console.error("          aave_action, config_action");
}
