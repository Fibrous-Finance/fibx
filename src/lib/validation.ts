import { z } from "zod";
import { ErrorCode, FibxError } from "./errors.js";

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");

export const amountSchema = z.string().refine(
	(v) => {
		const clean = v.replace(/[$,]/g, "");
		return !isNaN(Number(clean)) && Number(clean) > 0;
	},
	{
		message: "Amount must be a positive number",
	}
);

/**
 * The bound on slippage, defined once for every surface that takes one.
 *
 * Slippage is the floor on what a user receives: the swap path derives the
 * on-chain `min_received` from this number, and the local signing policy
 * cannot catch a bad one — `maxValue` bounds native value only, so an ERC-20
 * swap reaches the router with `value: 0n` and the cap never sees the amount.
 * A fat-fingered "5" becoming "50" collapses the floor with nothing in the way.
 *
 * Three callers, one definition:
 *
 * - the MCP tool schemas (`src/mcp/tools/trade.ts`), which is what the model
 *   calls, wrapping `slippageSchema` directly;
 * - `fibx quote` / `fibx trade` (`src/index.ts` → these commands), which pass
 *   through neither the schema nor any UI and were unbounded until this
 *   existed;
 * - the swap card, which refuses at a deliberately tighter 5%
 *   (`ui/src/quote.ts`) because a human typing into a box is a different risk
 *   from a caller asking for a wide slippage on an illiquid pair.
 *
 * The bound is not the card's: it is the outer wall behind it.
 */
export const MIN_SLIPPAGE_PERCENT = 0.01;
export const MAX_SLIPPAGE_PERCENT = 50;

export const slippageSchema = z.number().min(MIN_SLIPPAGE_PERCENT).max(MAX_SLIPPAGE_PERCENT);

export function validateSlippage(slippage: number): number {
	const result = slippageSchema.safeParse(slippage);
	if (!result.success) {
		throw new FibxError(
			ErrorCode.VALIDATION_ERROR,
			`Slippage must be between ${MIN_SLIPPAGE_PERCENT} and ${MAX_SLIPPAGE_PERCENT} percent — it is the floor on what you receive, and the swap sends it on-chain.`
		);
	}
	return result.data;
}

export function validateAddress(addr: string): string {
	const result = addressSchema.safeParse(addr);
	if (!result.success) {
		throw new FibxError(ErrorCode.INVALID_ADDRESS, result.error.message);
	}
	return result.data;
}

export function validateAmount(amount: string): string {
	const result = amountSchema.safeParse(amount);
	if (!result.success) {
		throw new FibxError(ErrorCode.INVALID_AMOUNT, result.error.message);
	}
	return result.data;
}
