import { describe, expect, it } from "vitest";
import { applyRule } from "./index.js";

describe("applyRule", () => {
	it("sets a per-chain cap", () => {
		expect(applyRule({}, "base.maxValue", "0.05")).toEqual({ maxValue: { base: "0.05" } });
	});

	it("keeps rules already set for other chains", () => {
		const before = { maxValue: { base: "0.05" } };

		expect(applyRule(before, "monad.maxValue", "10")).toEqual({
			maxValue: { base: "0.05", monad: "10" },
		});
	});

	it("sets the chain allowlist from a comma-separated list", () => {
		expect(applyRule({}, "allowedChains", "base,monad")).toEqual({
			allowedChains: ["base", "monad"],
		});
	});

	it("sets per-chain destinations from a comma-separated list", () => {
		const value =
			"0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222";

		expect(applyRule({}, "base.allowedDestinations", value)).toEqual({
			allowedDestinations: {
				base: [
					"0x1111111111111111111111111111111111111111",
					"0x2222222222222222222222222222222222222222",
				],
			},
		});
	});

	it("sets an expiry", () => {
		expect(applyRule({}, "expiry", "2026-12-31")).toEqual({ expiry: "2026-12-31" });
	});

	// Storing a value the evaluator will not honour is the failure this
	// validation exists to prevent.
	it("refuses a cap that is not a number", () => {
		expect(() => applyRule({}, "base.maxValue", "lots")).toThrow(/number/i);
	});

	it("refuses an unknown chain", () => {
		expect(() => applyRule({}, "solana.maxValue", "1")).toThrow(/solana/);
	});

	it("refuses an unknown rule", () => {
		expect(() => applyRule({}, "base.maxGas", "1")).toThrow(/maxGas/);
	});

	it("refuses a malformed date", () => {
		expect(() => applyRule({}, "expiry", "next tuesday")).toThrow(/date/i);
	});

	it("refuses a destination that is not an address", () => {
		expect(() => applyRule({}, "base.allowedDestinations", "not-an-address")).toThrow(
			/address/i
		);
	});

	it("refuses a chain allowlist naming a chain FibX does not offer", () => {
		expect(() => applyRule({}, "allowedChains", "base,solana")).toThrow(/solana/);
	});

	/**
	 * An empty allowlist is not an empty rule — it is a rule that forbids
	 * everything. It fails closed, so nothing unsafe happens, but nobody types
	 * `fibx policy set allowedChains ""` meaning "block every chain"; they mean
	 * to remove the rule, which is `fibx policy clear allowedChains`.
	 */
	it("refuses an empty chain allowlist rather than blocking every chain", () => {
		expect(() => applyRule({}, "allowedChains", "")).toThrow(/empty|clear/i);
		expect(() => applyRule({}, "allowedChains", " , ")).toThrow(/empty|clear/i);
	});

	it("refuses an empty destination list rather than blocking every address", () => {
		expect(() => applyRule({}, "base.allowedDestinations", "")).toThrow(/empty|clear/i);
		expect(() => applyRule({}, "base.allowedDestinations", ",")).toThrow(/empty|clear/i);
	});
});
