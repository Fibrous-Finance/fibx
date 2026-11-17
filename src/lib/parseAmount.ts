import { parseUnits, formatUnits } from "viem";
import { ErrorCode, FibxError } from "./errors.js";
import { validateAmount } from "./validation.js";

/**
 * Human units → base units, refusing anything it would have to rewrite.
 *
 * It used to strip `$` and `,` first (so `1,5` became 15), and parseUnits
 * rounds a fraction longer than the token's decimals — `1.0000005` USDC would
 * have sent 1.000001. Either is a different amount from the one written.
 */
export function parseAmount(amount: string, decimals: number): bigint {
	validateAmount(amount);
	const fraction = amount.split(".")[1] ?? "";
	if (fraction.length > decimals) {
		throw new FibxError(
			ErrorCode.INVALID_AMOUNT,
			`${amount} has more decimal places than the token's ${decimals}.`
		);
	}
	return parseUnits(amount, decimals);
}

export function formatAmount(amount: bigint, decimals: number): string {
	return formatUnits(amount, decimals);
}
