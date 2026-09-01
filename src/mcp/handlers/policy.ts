import { loadPolicy, policyPath, savePolicy, clearPolicy } from "../../services/policy/store.js";
import { applyRule, isEmptyPolicy, removeRule } from "../../commands/policy/index.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";
import { jsonResult } from "./utils.js";

/**
 * Reads the signing policy without changing it.
 *
 * The three states are the point. "unreadable" means a file is there and
 * cannot be trusted, which refuses every transaction — reporting it as
 * "absent" would tell the caller that nothing is blocking them when in fact
 * everything is.
 */
export async function handleGetPolicy() {
	const policy = loadPolicy();
	const path = policyPath();

	if (policy === "unreadable") {
		return jsonResult({
			state: "unreadable",
			path,
			message:
				"The policy file cannot be read, so nothing will be signed until it is fixed or removed.",
		});
	}

	if (!policy || isEmptyPolicy(policy)) {
		return jsonResult({
			state: "absent",
			path,
			message: "No signing policy is set — nothing limits what this wallet will sign.",
		});
	}

	return jsonResult({ state: "active", rules: policy, path });
}

/** Shared by both writers: refuse to act on a file we could not parse. */
function readForWrite() {
	const policy = loadPolicy();
	if (policy === "unreadable") {
		throw new FibxError(
			ErrorCode.POLICY_BLOCKED,
			`The policy at ${policyPath()} cannot be read. Fix it, or clear it, before changing rules — ` +
				`writing over it would discard whatever it holds.`
		);
	}
	return policy;
}

export async function handleSetPolicyRule({ rule, value }: { rule: string; value: string }) {
	const current = readForWrite();
	// applyRule throws a plain Error (not FibxError) on an unknown rule, chain,
	// address or number. findFibxError won't match a plain Error, so
	// withErrorHandling falls back to reporting it as UNKNOWN_ERROR via the
	// same parseEvmError path the CLI's own catch already uses for these same
	// throws — MCP and CLI still agree on the message. Letting it propagate
	// keeps one grammar and one set of messages; promoting these throw sites
	// to FibxError is its own task, since it also changes the CLI's visible
	// output.
	const next = applyRule(current ?? {}, rule, value);
	savePolicy(next);
	return jsonResult({ ok: true, rule, value, rules: next });
}

export async function handleClearPolicyRule({ rule, all }: { rule?: string; all?: true }) {
	// The whole-policy delete needs an explicit, recognisable call — `{ all:
	// true }` — rather than reading silence (neither argument) as consent, or
	// guessing when both are given. Naming exactly what to pass beats either
	// picking a default or reporting a generic schema failure.
	if (all && rule !== undefined) {
		throw new FibxError(
			ErrorCode.VALIDATION_ERROR,
			"Pass either `rule` to remove one rule, or `all: true` to remove the whole policy — not both."
		);
	}

	if (all) {
		// Deliberately does not go through readForWrite(): this must still
		// delete an unreadable policy, exactly as `fibx policy clear --yes`
		// does — refusing here would leave an untrustworthy file in place with
		// no way to clear it from this surface.
		clearPolicy();
		return jsonResult({
			ok: true,
			changed: true,
			message: "Signing policy removed — nothing limits signing now.",
		});
	}

	if (rule === undefined) {
		throw new FibxError(
			ErrorCode.VALIDATION_ERROR,
			"Pass `rule` to remove one rule, or `all: true` to remove the whole policy."
		);
	}

	const current = readForWrite();
	// removeRule returns null when the rule is valid but was never set, and
	// throws when the rule name itself is wrong — "" included, since it splits
	// to no chain. Two different answers. current ?? {} is passed even when no
	// policy file exists at all, so an invalid rule name is still rejected
	// rather than quietly reported as "not set".
	const next = removeRule(current ?? {}, rule);
	if (!next) {
		return jsonResult({ ok: true, changed: false, message: `${rule} was not set.` });
	}

	savePolicy(next);
	return jsonResult({ ok: true, changed: true, rule, rules: next });
}
