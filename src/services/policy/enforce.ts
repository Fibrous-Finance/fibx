import { ErrorCode, FibxError } from "../../lib/errors.js";
import { evaluate } from "./evaluate.js";
import { loadPolicy, policyPath } from "./store.js";
import type { PolicyTransaction } from "./types.js";

/**
 * The single gate both adapters call, so the message a user sees on a refusal
 * is written once rather than twice.
 *
 * Throws rather than returning a verdict: the callers are a viem account's
 * signTransaction and an EIP-1193 provider's request, neither of which has
 * anywhere to put a "no" except an exception.
 */
export function assertAllowed(tx: PolicyTransaction): void {
	const policy = loadPolicy();

	if (policy === "unreadable") {
		throw new FibxError(
			ErrorCode.POLICY_BLOCKED,
			`Signing policy at ${policyPath()} cannot be read, so nothing will be signed. ` +
				`Fix the file, or remove it with \`fibx policy clear --yes\`.`
		);
	}

	const verdict = evaluate(tx, policy, new Date());
	if (verdict.allowed) return;

	throw new FibxError(
		ErrorCode.POLICY_BLOCKED,
		`${verdict.message} See all rules with \`fibx policy show\`.`
	);
}
