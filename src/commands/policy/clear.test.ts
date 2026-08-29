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

	// Same class of bug as storing an invalid value: telling the user
	// something happened when it did not.
	it("refuses to claim success removing a rule that was never set", () => {
		expect(() => removeRule({}, "base.maxValue")).toThrow(/nothing to remove/i);
	});

	it("refuses to claim success removing one chain's cap when only a sibling's is set", () => {
		const before = { maxValue: { monad: "10" } };

		expect(() => removeRule(before, "base.maxValue")).toThrow(/nothing to remove/i);
	});

	it("refuses to claim success removing a scalar rule that was never set", () => {
		expect(() => removeRule({}, "expiry")).toThrow(/nothing to remove/i);
	});

	it("refuses an unknown rule rather than silently no-op'ing", () => {
		expect(() => removeRule({}, "base.maxGas")).toThrow(/maxGas/);
	});

	it("refuses an unknown chain", () => {
		expect(() => removeRule({}, "solana.maxValue")).toThrow(/solana/);
	});
});
