import { describe, it, expect } from "vitest";
import { calculateMaxSafeWithdraw } from "./risk.js";

describe("calculateMaxSafeWithdraw", () => {
	// Regression: currentLiquidationThreshold arrives already decoded to a
	// fraction (0.825). A previous version divided it by 10_000 a second time,
	// inflating requiredCollateral ~12_121x and pinning maxSafeWithdraw to 0.
	it("treats the liquidation threshold as a fraction, not basis points", () => {
		const result = calculateMaxSafeWithdraw(1000, 100, 0.825);

		expect(result).not.toBeNull();
		// 100 / 0.825 = 121.21..., NOT 100 / 0.0000825 = 1_212_121
		expect(result!.requiredCollateralUsd).toBeCloseTo(121.21, 2);
		expect(result!.maxSafeWithdrawUsd).toBeCloseTo(878.79, 2);
	});

	it("does not collapse max safe withdraw to zero for a healthy position", () => {
		const result = calculateMaxSafeWithdraw(10_000, 1_000, 0.8);

		// The double-scaling bug made this 0 for every realistic position.
		expect(result!.maxSafeWithdrawUsd).toBeGreaterThan(0);
		expect(result!.maxSafeWithdrawUsd).toBeCloseTo(8_750, 2);
	});

	it("never reports a negative withdrawable amount when underwater", () => {
		const result = calculateMaxSafeWithdraw(100, 500, 0.8);

		expect(result!.requiredCollateralUsd).toBeCloseTo(625, 2);
		expect(result!.maxSafeWithdrawUsd).toBe(0);
	});

	it("allows withdrawing everything when there is no debt", () => {
		const result = calculateMaxSafeWithdraw(2_500, 0, 0.85);

		expect(result!.requiredCollateralUsd).toBe(0);
		expect(result!.maxSafeWithdrawUsd).toBe(2_500);
	});

	it("returns null when the threshold is unusable", () => {
		expect(calculateMaxSafeWithdraw(1_000, 100, 0)).toBeNull();
		expect(calculateMaxSafeWithdraw(1_000, 100, -1)).toBeNull();
		expect(calculateMaxSafeWithdraw(1_000, 100, NaN)).toBeNull();
	});
});
