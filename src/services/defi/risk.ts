/**
 * Pure Aave risk math — no RPC, no wallet, no viem.
 *
 * Unit contract (important): every value here is expected in its already-decoded
 * form, matching what `AaveService.getUserAccountData` returns:
 *   - USD amounts are plain dollars (Aave's 8-decimal base currency, decoded).
 *   - `liquidationThreshold` is a FRACTION, e.g. 0.825 for 82.5%.
 *     Aave reports it on-chain in basis points (8250); the decoding to a
 *     fraction happens once, in getUserAccountData. Do not scale it again.
 */

export interface MaxSafeWithdraw {
	/** Collateral that must stay deposited to keep the position solvent. */
	requiredCollateralUsd: number;
	/** Collateral that can be withdrawn on top of that, never negative. */
	maxSafeWithdrawUsd: number;
}

/**
 * Given a position, work out how much collateral can be pulled out before the
 * health factor would drop to 1.0.
 *
 * Returns null when the threshold is unusable (zero or negative), which happens
 * when the user has no collateral-enabled reserves — there is nothing to advise.
 */
export function calculateMaxSafeWithdraw(
	totalCollateralUsd: number,
	totalDebtUsd: number,
	liquidationThreshold: number
): MaxSafeWithdraw | null {
	if (!(liquidationThreshold > 0)) return null;

	const requiredCollateralUsd = totalDebtUsd / liquidationThreshold;
	const maxSafeWithdrawUsd = Math.max(0, totalCollateralUsd - requiredCollateralUsd);

	return { requiredCollateralUsd, maxSafeWithdrawUsd };
}
