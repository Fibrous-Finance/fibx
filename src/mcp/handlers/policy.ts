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
	// applyRule throws FibxError on an unknown rule, chain, address or number.
	// Letting that propagate keeps one grammar and one set of messages.
	const next = applyRule(current ?? {}, rule, value);
	savePolicy(next);
	return jsonResult({ ok: true, rule, value, rules: next });
}

export async function handleClearPolicyRule({ rule }: { rule?: string }) {
	if (!rule) {
		clearPolicy();
		return jsonResult({
			ok: true,
			changed: true,
			message: "Signing policy removed — nothing limits signing now.",
		});
	}

	const current = readForWrite();
	// removeRule returns null when the rule is valid but was never set, and
	// throws when the rule name itself is wrong. Two different answers.
	const next = current ? removeRule(current, rule) : null;
	if (!next) {
		return jsonResult({ ok: true, changed: false, message: `${rule} was not set.` });
	}

	savePolicy(next);
	return jsonResult({ ok: true, changed: true, rule, rules: next });
}
