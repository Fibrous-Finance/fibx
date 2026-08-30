import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleGetPolicy } from "../handlers/policy.js";
import { withErrorHandling } from "./error-handling.js";

export function registerPolicyTools(server: McpServer): number {
	server.registerTool(
		"get_policy",
		{
			title: "Read the Signing Policy",
			description:
				"Read the local signing policy that bounds every transaction fibx signs. " +
				"Returns active with its rules, absent when nothing is set, or unreadable " +
				"when a file is present but cannot be parsed — which refuses everything.",
			inputSchema: {},
			annotations: {
				title: "Signing Policy",
				// Reads one file. No session write, no chain call, no relay.
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		withErrorHandling(handleGetPolicy)
	);

	return 1;
}
