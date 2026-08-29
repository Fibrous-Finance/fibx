import { z } from "zod";

/**
 * The transaction as the policy sees it, normalised by whichever adapter
 * caught it. The two adapters observe different shapes — a viem account gets
 * bigints, a WalletConnect provider gets hex strings — so they normalise into
 * this and the evaluator stays free of either.
 */
export interface PolicyTransaction {
	/** Chain name, as in CHAIN_NAMES: "base", "hyperevm", "monad". */
	chain: string;
	/** Absent for contract creation. */
	to?: string;
	/** Native value in wei. */
	value: bigint;
}

export const policySchema = z.object({
	allowedChains: z.array(z.string()).optional(),
	/** Chain name to a decimal amount in native units, e.g. { base: "0.05" }. */
	maxValue: z.record(z.string(), z.string()).optional(),
	/** Chain name to the addresses value and calls may go to. */
	allowedDestinations: z.record(z.string(), z.array(z.string())).optional(),
	/** ISO date. Past it, everything is refused. */
	expiry: z.string().optional(),
});

export type Policy = z.infer<typeof policySchema>;

export type PolicyVerdict =
	| { allowed: true }
	| { allowed: false; rule: string; message: string };
