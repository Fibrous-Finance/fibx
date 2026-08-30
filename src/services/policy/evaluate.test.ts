import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.js";
import { policySchema } from "./types.js";
import type { Policy, PolicyTransaction } from "./types.js";

const ROUTER = "0x274602a953847d807231d2370072f5f4e4594b44";
const STRANGER = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-08-29T12:00:00.000Z");

function tx(overrides: Partial<PolicyTransaction> = {}): PolicyTransaction {
	return { chain: "base", to: ROUTER, value: 0n, ...overrides };
}

describe("evaluate", () => {
	// A fresh install has no policy, and must behave exactly as it does today.
	it("permits everything when there is no policy", () => {
		expect(evaluate(tx({ value: 10n ** 21n }), null, NOW)).toEqual({ allowed: true });
	});

	it("permits everything when the policy sets no rules", () => {
		expect(evaluate(tx({ value: 10n ** 21n }), {}, NOW)).toEqual({ allowed: true });
	});

	describe("allowedChains", () => {
		const policy: Policy = { allowedChains: ["base", "monad"] };

		it("permits a listed chain", () => {
			expect(evaluate(tx({ chain: "base" }), policy, NOW).allowed).toBe(true);
		});

		it("refuses an unlisted chain and names the rule", () => {
			const verdict = evaluate(tx({ chain: "hyperevm" }), policy, NOW);

			expect(verdict.allowed).toBe(false);
			if (verdict.allowed) throw new Error("unreachable");
			expect(verdict.rule).toBe("allowedChains");
			expect(verdict.message).toContain("hyperevm");
		});

		/**
		 * The file is meant to be hand-edited, and `allowedDestinations`
		 * already lowercases both sides. Two normalisation rules for values
		 * out of the same file is a trap: `["Base"]` failed closed with
		 * `Policy does not allow base. Allowed: Base.`, which reads like a bug
		 * in FibX rather than a capital letter in the user's file.
		 */
		it("matches a chain name case-insensitively, as destinations do", () => {
			expect(evaluate(tx({ chain: "base" }), { allowedChains: ["Base"] }, NOW).allowed).toBe(
				true
			);
			expect(evaluate(tx({ chain: "base" }), { allowedChains: ["BASE"] }, NOW).allowed).toBe(
				true
			);
		});

		it("still refuses a chain that is genuinely not listed", () => {
			expect(
				evaluate(tx({ chain: "hyperevm" }), { allowedChains: ["Base"] }, NOW).allowed
			).toBe(false);
		});
	});

	describe("maxValue", () => {
		const policy: Policy = { maxValue: { base: "0.05" } };

		it("permits a value under the cap", () => {
			expect(evaluate(tx({ value: 10n ** 16n }), policy, NOW).allowed).toBe(true); // 0.01
		});

		// Exactly at the cap is permitted: a cap is a maximum, not a bound below.
		it("permits a value exactly at the cap", () => {
			expect(evaluate(tx({ value: 5n * 10n ** 16n }), policy, NOW).allowed).toBe(true);
		});

		it("refuses a value over the cap and names both figures", () => {
			const verdict = evaluate(tx({ value: 5n * 10n ** 17n }), policy, NOW); // 0.5

			expect(verdict.allowed).toBe(false);
			if (verdict.allowed) throw new Error("unreachable");
			expect(verdict.rule).toBe("maxValue");
			expect(verdict.message).toContain("0.5");
			expect(verdict.message).toContain("0.05");
		});

		// A cap on one chain says nothing about another.
		it("ignores a cap set for a different chain", () => {
			expect(evaluate(tx({ chain: "monad", value: 10n ** 20n }), policy, NOW).allowed).toBe(
				true
			);
		});

		// A malformed cap (past the schema) should return a refusal, not throw.
		it("refuses a malformed cap rather than throwing", () => {
			const malformedPolicy: Policy = { maxValue: { base: "not-a-number" } };
			const verdict = evaluate(tx(), malformedPolicy, NOW);

			expect(verdict.allowed).toBe(false);
			if (verdict.allowed) throw new Error("unreachable");
			expect(verdict.rule).toBe("maxValue");
			expect(verdict.message).toContain("not-a-number");
		});
	});

	describe("allowedDestinations", () => {
		const policy: Policy = { allowedDestinations: { base: [ROUTER] } };

		it("permits a listed destination", () => {
			expect(evaluate(tx({ to: ROUTER }), policy, NOW).allowed).toBe(true);
		});

		it("matches a destination whatever its casing", () => {
			expect(evaluate(tx({ to: ROUTER.toUpperCase() }), policy, NOW).allowed).toBe(true);
		});

		it("refuses an unlisted destination", () => {
			const verdict = evaluate(tx({ to: STRANGER }), policy, NOW);

			expect(verdict.allowed).toBe(false);
			if (verdict.allowed) throw new Error("unreachable");
			expect(verdict.rule).toBe("allowedDestinations");
		});

		// Contract creation has no `to`. An allowlist that names destinations
		// cannot vouch for one that does not exist.
		it("refuses a transaction with no destination", () => {
			expect(evaluate(tx({ to: undefined }), policy, NOW).allowed).toBe(false);
		});
	});

	describe("expiry", () => {
		// A lapsed policy refuses rather than permits: the opposite would turn a
		// forgotten limit into the silent removal of every limit.
		it("refuses once the expiry has passed", () => {
			const verdict = evaluate(tx(), { expiry: "2026-08-28" }, NOW);

			expect(verdict.allowed).toBe(false);
			if (verdict.allowed) throw new Error("unreachable");
			expect(verdict.rule).toBe("expiry");
		});

		it("permits before the expiry", () => {
			expect(evaluate(tx(), { expiry: "2026-12-31" }, NOW).allowed).toBe(true);
		});

		it("refuses an unparseable expiry rather than ignoring it", () => {
			expect(evaluate(tx(), { expiry: "not-a-date" }, NOW).allowed).toBe(false);
		});

		/**
		 * A bare date parses as UTC midnight at the START of that day, so
		 * `expiry 2026-12-31` lapses as Dec 31 begins, not as it ends. That is
		 * `new Date("YYYY-MM-DD")`'s documented behaviour and the `set` help
		 * text now says so; this pins it, because the tempting "fix" — rolling
		 * the date forward to the end of the day — would silently extend every
		 * expiry already on disk by a day.
		 */
		it("treats a bare date as the start of that day in UTC, not the end", () => {
			const oneSecondIntoTheDay = new Date("2026-12-31T00:00:01Z");

			expect(evaluate(tx(), { expiry: "2026-12-31" }, oneSecondIntoTheDay).allowed).toBe(
				false
			);
			expect(
				evaluate(tx(), { expiry: "2026-12-31" }, new Date("2026-12-30T23:59:59Z")).allowed
			).toBe(true);
		});
	});

	// Order matters only for which message the user sees first; expiry is
	// checked before anything else because a lapsed policy makes the rest moot.
	it("reports expiry before another violated rule", () => {
		const verdict = evaluate(
			tx({ chain: "hyperevm" }),
			{
				expiry: "2026-08-28",
				allowedChains: ["base"],
			},
			NOW
		);

		expect(verdict.allowed).toBe(false);
		if (verdict.allowed) throw new Error("unreachable");
		expect(verdict.rule).toBe("expiry");
	});

	describe("schema validation", () => {
		// Schema catches malformed caps before they reach the evaluator.
		it("rejects a policy with a malformed cap value", () => {
			const malformed = { maxValue: { base: "not-a-number" } };
			expect(() => policySchema.parse(malformed)).toThrow();
		});
	});
});
