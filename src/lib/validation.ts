import { z } from "zod";
import { ErrorCode, FibxError } from "./errors.js";

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");

/**
 * A plain decimal in token units, with a dot as the decimal point.
 *
 * This used to strip `$` and `,` before parsing, so `1,5` — a decimal comma —
 * traded 15, and `$100 ETH` traded 100 ETH. Neither can be read back safely:
 * a comma is a decimal point in half the world and a thousands separator in the
 * other half, and a `$` suggests a dollar value FibX never converts. Both are
 * refused, with the spelling to use instead. So is anything else Number()
 * would accept but viem's parseUnits would not read the same way (`1e3`,
 * `0x10`, ` 1 `).
 */
const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

function amountProblem(v: string): string | null {
	if (v.includes(",")) {
		return "Amounts take a dot as the decimal point and no thousands separators — write 1.5, not 1,5.";
	}
	if (v.includes("$")) {
		return "Amounts are in token units, not dollars — drop the $ (write 100, not $100).";
	}
	if (!DECIMAL.test(v)) return "Amount must be a plain decimal number, like 1.5 or 100.";
	if (!(Number(v) > 0)) return "Amount must be a positive number";
	return null;
}

export const amountSchema = z.string().superRefine((v, ctx) => {
	const message = amountProblem(v);
	if (message) ctx.addIssue({ code: "custom", message });
});

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
 * - the app's swap form, which refuses at a deliberately tighter 5%
 *   (`ui/src/quote.ts`) because a human typing into a box is a different risk
 *   from a caller asking for a wide slippage on an illiquid pair.
 *
 * The bound is not the form's: it is the outer wall behind it.
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
		throw new FibxError(
			ErrorCode.INVALID_ADDRESS,
			result.error.issues[0]?.message ?? "Invalid EVM address"
		);
	}
	return result.data;
}

export function validateAmount(amount: string): string {
	const result = amountSchema.safeParse(amount);
	if (!result.success) {
		// zod 4's error.message is the issue list as JSON; the sentence is the issue's.
		throw new FibxError(
			ErrorCode.INVALID_AMOUNT,
			result.error.issues[0]?.message ?? "Invalid amount"
		);
	}
	return result.data;
}
