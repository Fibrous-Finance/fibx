import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleGetAuthStatus, handleConfigAction } from "../handlers/auth.js";
import { withErrorHandling } from "./error-handling.js";

const ChainEnum = z.enum(["base", "citrea", "hyperevm", "monad"]);

export function registerAuthAndConfigTools(server: McpServer): number {
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
			annotations: {
				title: "Auth & Health Check",
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: true,
			},
		},
		withErrorHandling(handleGetAuthStatus)
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
		withErrorHandling(handleConfigAction)
	);

	return 2;
}
