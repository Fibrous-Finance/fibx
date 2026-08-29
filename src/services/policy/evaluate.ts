import { formatEther, parseEther } from "viem";
import { CHAIN_NAMES, type ChainName } from "../chain/constants.js";
import type { Policy, PolicyTransaction, PolicyVerdict } from "./types.js";

const ALLOWED: PolicyVerdict = { allowed: true };

function refuse(rule: string, message: string): PolicyVerdict {
	return { allowed: false, rule, message };
}

/**
 * The per-chain rules are keyed by offered chain name, and the schema now
 * refuses any other key. A transaction on a chain FibX still knows how to talk
 * to but no longer offers (citrea) therefore has no per-chain rule to find —
 * the same outcome as before, said explicitly rather than by a failed lookup.
 */
function chainKey(chain: string): ChainName | null {
	return (CHAIN_NAMES as readonly string[]).includes(chain) ? (chain as ChainName) : null;
}

/**
 * Decides whether one transaction is within the policy. Pure: no I/O, no clock
 * of its own — `now` is passed so expiry is testable.
 *
 * Every rule is optional and an absent rule permits, so a fresh install with no
 * policy behaves exactly as it did before this existed.
 */
export function evaluate(tx: PolicyTransaction, policy: Policy | null, now: Date): PolicyVerdict {
	if (!policy) return ALLOWED;

	// First, because a lapsed policy makes every other rule moot — and because
	// refusing is the only safe direction: treating a forgotten expiry as
	// permission would silently remove every limit the user set.
	if (policy.expiry !== undefined) {
		const expiresAt = new Date(policy.expiry);
		if (Number.isNaN(expiresAt.getTime())) {
			return refuse(
				"expiry",
				`Policy expiry "${policy.expiry}" is not a date FibX can read, so nothing is signed. Fix it with \`fibx policy set expiry <YYYY-MM-DD>\`.`
			);
		}
		if (now >= expiresAt) {
			return refuse(
				"expiry",
				`Policy expired on ${policy.expiry}. Extend it with \`fibx policy set expiry <YYYY-MM-DD>\`, or remove it with \`fibx policy clear expiry\`.`
			);
		}
	}

	if (policy.allowedChains && !policy.allowedChains.includes(tx.chain)) {
		return refuse(
			"allowedChains",
			`Policy does not allow ${tx.chain}. Allowed: ${policy.allowedChains.join(", ")}.`
		);
	}

	const key = chainKey(tx.chain);

	const cap = key ? policy.maxValue?.[key] : undefined;
	if (cap !== undefined) {
		let capWei: bigint;
		try {
			capWei = parseEther(cap);
		} catch {
			// Reachable only past the schema — a direct caller, or a policy
			// object built in code. Refusing keeps the contract that this
			// function always returns a verdict, and keeps the failure closed.
			return refuse(
				"maxValue",
				`Policy cap "${cap}" on ${tx.chain} is not an amount FibX can read, so nothing is signed. Fix it with \`fibx policy set ${tx.chain}.maxValue <amount>\`.`
			);
		}
		if (tx.value > capWei) {
			return refuse(
				"maxValue",
				`Transaction exceeds the per-transaction cap on ${tx.chain}: ${formatEther(tx.value)} attempted, ${cap} allowed.`
			);
		}
	}

	const destinations = key ? policy.allowedDestinations?.[key] : undefined;
	if (destinations) {
		const to = tx.to?.toLowerCase();
		if (!to) {
			return refuse(
				"allowedDestinations",
				`Policy limits where funds may go on ${tx.chain}, and this transaction has no destination (contract creation).`
			);
		}
		if (!destinations.some((d) => d.toLowerCase() === to)) {
			return refuse(
				"allowedDestinations",
				`Policy does not allow sending to ${tx.to} on ${tx.chain}.`
			);
		}
	}

	return ALLOWED;
}
