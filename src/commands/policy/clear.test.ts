import { describe, expect, it } from "vitest";
import { removeRule } from "./index.js";

describe("removeRule", () => {
	it("removes one chain's cap while a sibling chain's cap survives", () => {
		const before = { maxValue: { base: "0.05", monad: "10" } };

		expect(removeRule(before, "base.maxValue")).toEqual({ maxValue: { monad: "10" } });
	});

	// Leaving `{ maxValue: {} }` behind reads as a policy to a naive emptiness
	// check, even though the evaluator treats an empty group as no
	// restriction at all — the group itself must go when its last chain does.
	it("removes the group entirely when its last entry goes", () => {
		const before = { maxValue: { base: "0.05" } };

		expect(removeRule(before, "base.maxValue")).toEqual({});
	});

	it("removes a scalar rule like expiry", () => {
		const before = { expiry: "2026-12-31" };

		expect(removeRule(before, "expiry")).toEqual({});
	});

	it("removes allowedChains", () => {
		const before = { allowedChains: ["base", "monad"] };

		expect(removeRule(before, "allowedChains")).toEqual({});
	});

	it("removes one chain's destinations while a sibling chain's survive", () => {
		const before = {
			allowedDestinations: {
				base: ["0x1111111111111111111111111111111111111111"],
				monad: ["0x2222222222222222222222222222222222222222"],
			},
		};

		expect(removeRule(before, "base.allowedDestinations")).toEqual({
			allowedDestinations: {
				monad: ["0x2222222222222222222222222222222222222222"],
			},
		});
	});

	// A validly-named rule that simply is not set is not a mistake — a script
	// clearing a rule defensively, to reach a known state, must be able to
	// no-op quietly rather than being told it made an error it did not make.
	// This is a different event from an invalid rule (below), and the two
	// must stay distinguishable: throwing for both would tell a caller doing
	// `fibx policy clear expiry` on a fresh install that it made a mistake.
	it("reports no change removing a rule that was never set, rather than throwing", () => {
		expect(removeRule({}, "base.maxValue")).toBeNull();
	});

	it("reports no change removing one chain's cap when only a sibling's is set", () => {
		const before = { maxValue: { monad: "10" } };

		expect(removeRule(before, "base.maxValue")).toBeNull();
	});

	it("reports no change removing a scalar rule that was never set", () => {
		expect(removeRule({}, "expiry")).toBeNull();
	});

	// An invalid rule name is a different event from "nothing to remove": it
	// is a mistake, the same as a bad `set`, and still throws.
	it("still throws for an invalid rule name rather than silently no-op'ing", () => {
		expect(() => removeRule({}, "base.maxGas")).toThrow(/maxGas/);
	});

	it("still throws for an unknown chain", () => {
		expect(() => removeRule({}, "solana.maxValue")).toThrow(/solana/);
	});
});
