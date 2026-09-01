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
				// tighten, so it must never claim to be read-only. It also must
				// not claim to be additive: setting an existing rule *replaces*
				// its value — a lower maxValue can widen back to a higher one —
				// which is exactly the kind of update the SDK's destructiveHint
				// exists to flag. Downgrading it to false would contradict
				// clear_policy_rule's destructiveHint: true for the same
				// consequence: a cap that stops binding.
				readOnlyHint: false,
				destructiveHint: true,
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
				"Remove one rule from the local signing policy with `rule`, or remove the " +
				"whole policy with `all: true`. Removing everything leaves nothing limiting " +
				"what this wallet will sign. Exactly one of `rule` or `all` must be given — " +
				"a call naming neither or both is rejected.",
			inputSchema: {
				// min(1): an explicit empty string must not be silently treated
				// the same as a valid rule name — a blank form field in the
				// panel sends "", not omission.
				rule: z.string().min(1).optional().describe("The rule to remove"),
				// A required literal rather than a boolean default: the
				// whole-policy delete must be an explicit, recognisable call,
				// not something reached by omitting `rule` and letting silence
				// read as consent.
				all: z
					.literal(true)
					.optional()
					.describe("Set to true to remove the whole policy, instead of `rule`"),
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
