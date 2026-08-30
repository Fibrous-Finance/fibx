import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import {
	handleGetAuthStatus,
	handleConfigAction,
	handleConnectWallet,
	handleGetConnectStatus,
	handleLogout,
} from "../handlers/auth.js";
import { withErrorHandling } from "./error-handling.js";
import { ChainEnum } from "./schemas.js";
import { jsonResult } from "../handlers/utils.js";
import { WALLET_PANEL_URI } from "../ui.js";

export function registerAuthAndConfigTools(server: McpServer): number {
	registerAppTool(
		server,
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
			_meta: { ui: { resourceUri: WALLET_PANEL_URI } },
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

	server.registerTool(
		"connect_wallet",
		{
			title: "Connect an External Wallet",
			description:
				"Start a WalletConnect pairing so the user can sign with their own wallet " +
				"(MetaMask, Rabby, Rainbow, Phantom). Returns a URI and a QR image immediately — " +
				"show the QR to the user, then poll get_connect_status until it reports connected.",
			inputSchema: {},
			annotations: {
				title: "Connect Wallet",
				// Not read-only: on approval this writes a brand-new session and
				// discards whatever was there, a Privy login or an imported
				// private key included. Hosts key auto-approval off
				// readOnlyHint, so claiming it would let a pairing replace a
				// session without anyone being asked. Not destructive either —
				// nothing on chain moves — and it reaches the relay, so the
				// world is open.
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: true,
			},
		},
		withErrorHandling(async () => jsonResult(await handleConnectWallet()))
	);

	server.registerTool(
		"get_connect_status",
		{
			title: "Check Wallet Connection",
			description:
				"Poll a pairing started by connect_wallet. Returns pending, connected, failed, or unknown.",
			inputSchema: {
				pairingId: z.string().describe("The pairingId returned by connect_wallet"),
			},
			annotations: {
				title: "Connection Status",
				// Reads a process-local map and nothing else: no session write,
				// no chain call, no relay round-trip.
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		withErrorHandling(async (args: { pairingId: string }) =>
			jsonResult(await handleGetConnectStatus(args))
		)
	);

	server.registerTool(
		"logout",
		{
			title: "End the Session",
			description:
				"Log out: end any WalletConnect pairing and clear the local session. " +
				"The user will need to authenticate again before signing anything.",
			inputSchema: {},
			annotations: {
				title: "Log Out",
				// Discards the session and reaches the relay to end the pairing.
				readOnlyHint: false,
				destructiveHint: true,
				openWorldHint: true,
			},
		},
		withErrorHandling(handleLogout)
	);

	return 5;
}
