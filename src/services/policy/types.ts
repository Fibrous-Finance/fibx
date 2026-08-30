import { z } from "zod";
import { CHAIN_NAMES } from "../chain/constants.js";

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

/**
 * Chain keys are named, not free-form, and unknown top-level keys are refused,
 * because the file is meant to be hand-edited and a typo used to fail OPEN:
 * `{"maxvalue": {...}}` parsed to `{}` and permitted everything, and
 * `{"maxValue": {"Base": …}}` parsed intact while the evaluator — which looks
 * up the lowercase name — never saw it, so `policy show` reported a cap that
 * did not exist. Both now fail the parse, which `loadPolicy` turns into
 * "unreadable", which refuses everything and names the file.
 *
 * `partialRecord`, not `record`: zod 4 made `z.record(z.enum([...]), …)`
 * EXHAUSTIVE, so it would require every chain be present and reject the
 * single-chain policy the docs tell people to write.
 *
 * `allowedChains` stays free-form strings deliberately — the evaluator matches
 * it case-insensitively, so "Base" there is honoured rather than refused.
 */
const chainKey = z.enum(CHAIN_NAMES);

export const policySchema = z
	.object({
		allowedChains: z.array(z.string()).optional(),
		/** Chain name to a decimal amount in native units, e.g. { base: "0.05" }. */
		maxValue: z
			.partialRecord(
				chainKey,
				z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal amount, e.g. 0.05")
			)
			.optional(),
		/** Chain name to the addresses value and calls may go to. */
		allowedDestinations: z.partialRecord(chainKey, z.array(z.string())).optional(),
		/** ISO date. Past it, everything is refused. */
		expiry: z.string().optional(),
	})
	.strict();

export type Policy = z.infer<typeof policySchema>;

export type PolicyVerdict = { allowed: true } | { allowed: false; rule: string; message: string };
