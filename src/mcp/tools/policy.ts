import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleClearPolicyRule, handleGetPolicy, handleSetPolicyRule } from "../handlers/policy.js";
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

	server.registerTool(
		"set_policy_rule",
		{
			title: "Set a Signing Policy Rule",
			description:
				"Set one rule on the local signing policy. Rules: expiry, allowedChains, " +
				"<chain>.maxValue, <chain>.allowedDestinations. Lists are comma-separated. " +
				"maxValue caps the native value of one transaction and does not bound token " +
				"amounts — an ERC-20 transfer carries value 0 — so use allowedDestinations " +
				"to bound where tokens may go.",
			inputSchema: {
				rule: z
					.string()
					.describe(
						"expiry, allowedChains, <chain>.maxValue or <chain>.allowedDestinations"
					),
				value: z.string().describe("The value; comma-separated for lists"),
			},
			annotations: {
				title: "Set Policy Rule",
				// Writes the file that bounds every signature. Hosts key their
				// approval prompt off this, and a rule can loosen as well as
				// tighten, so it must never claim to be read-only.
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		withErrorHandling(handleSetPolicyRule)
	);

	server.registerTool(
		"clear_policy_rule",
		{
			title: "Remove a Signing Policy Rule",
			description:
				"Remove one rule from the local signing policy, or omit the rule to remove " +
				"the policy entirely. Removing everything leaves nothing limiting what this " +
				"wallet will sign.",
			inputSchema: {
				// min(1): omitting the field means "remove everything", and an
				// explicit empty string must not be silently treated the same
				// way — a blank form field in the panel sends "", not omission.
				rule: z
					.string()
					.min(1)
					.optional()
					.describe("The rule to remove; omit to remove the whole policy"),
			},
			annotations: {
				title: "Clear Policy Rule",
				// Removing the policy lifts every bound there is.
				readOnlyHint: false,
				destructiveHint: true,
				openWorldHint: false,
			},
		},
		withErrorHandling(handleClearPolicyRule)
	);

	return 3;
}
