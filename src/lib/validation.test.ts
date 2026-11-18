import { describe, expect, it } from "vitest";
import { ErrorCode, FibxError } from "./errors.js";
import {
	MAX_SLIPPAGE_PERCENT,
	MIN_SLIPPAGE_PERCENT,
	slippageSchema,
	validateAddress,
	validateAmount,
	validateSlippage,
} from "./validation.js";
import { parseAmount } from "./parseAmount.js";

// The bound exists because slippage is the floor on what a user receives and
// nothing downstream can catch a bad one — `maxValue` in the signing policy
// bounds native value only, so an ERC-20 swap reaches the router with
// `value: 0n`. It lives here rather than in the MCP tool schema because the
// CLI's `--slippage` passes through neither that schema nor the app's swap form.
describe("validateSlippage", () => {
	it("returns an ordinary slippage unchanged", () => {
		expect(validateSlippage(0.5)).toBe(0.5);
		expect(validateSlippage(1)).toBe(1);
	});

	it("accepts both ends of the range", () => {
		expect(validateSlippage(MIN_SLIPPAGE_PERCENT)).toBe(MIN_SLIPPAGE_PERCENT);
		expect(validateSlippage(MAX_SLIPPAGE_PERCENT)).toBe(MAX_SLIPPAGE_PERCENT);
	});

	// The fat-finger this bound is for: a 5 typed as a 50, or a flag left
	// unbounded, collapsing the floor to nothing.
	it("refuses a slippage past the ceiling", () => {
		expect(() => validateSlippage(MAX_SLIPPAGE_PERCENT + 0.1)).toThrow(FibxError);
		expect(() => validateSlippage(100)).toThrow(FibxError);
	});

	it("refuses a zero or negative slippage", () => {
		expect(() => validateSlippage(0)).toThrow(FibxError);
		expect(() => validateSlippage(-1)).toThrow(FibxError);
	});

	// `fibx trade --slippage abc` reaches the command as parseFloat("abc"),
	// which is NaN — a number by typeof, and one that would sail past a bare
	// `> 0` comparison written the obvious way.
	it("refuses NaN, which is what parseFloat gives the CLI for junk", () => {
		expect(() => validateSlippage(parseFloat("abc"))).toThrow(FibxError);
	});

	it("names the range in the message a caller reads", () => {
		expect(() => validateSlippage(100)).toThrow(
			`Slippage must be between ${MIN_SLIPPAGE_PERCENT} and ${MAX_SLIPPAGE_PERCENT} percent`
		);
	});
});

// src/mcp/tools/trade.ts builds its `slippage` field by adding a default and a
// description to this schema. Pinning the schema here is what makes "one
// definition of the bound" a fact rather than a comment: if this drifts, the
// tool schema drifts with it.
describe("slippageSchema", () => {
	it("is the same bound validateSlippage enforces", () => {
		expect(slippageSchema.safeParse(0.5).success).toBe(true);
		expect(slippageSchema.safeParse(MAX_SLIPPAGE_PERCENT).success).toBe(true);
		expect(slippageSchema.safeParse(MAX_SLIPPAGE_PERCENT + 0.1).success).toBe(false);
		expect(slippageSchema.safeParse(0).success).toBe(false);
	});
});

/**
 * Every surface that takes an amount — trade, send, aave, quote and their MCP
 * tools — validates it here. `,` and `$` used to be stripped before parsing,
 * so a decimal comma traded ten times the amount written.
 */
describe("validateAmount", () => {
	it.each(["1", "1.5", "0.001", ".5", "100"])("accepts %s", (amount) => {
		expect(validateAmount(amount)).toBe(amount);
	});

	it("refuses a decimal comma and says to write a dot", () => {
		expect(() => validateAmount("1,5")).toThrow("write 1.5, not 1,5");
		expect(() => validateAmount("1,000")).toThrow(
			expect.objectContaining({ code: ErrorCode.INVALID_AMOUNT })
		);
	});

	it("refuses a dollar sign rather than reading $100 as 100 tokens", () => {
		expect(() => validateAmount("$100")).toThrow("not dollars");
	});

	it.each(["1e3", "0x10", " 1", "Infinity", "-1", "0", "abc", ""])("refuses %j", (amount) => {
		expect(() => validateAmount(amount)).toThrow(FibxError);
	});

	// zod 4's error.message is the issue list serialised as JSON.
	it("throws the sentence, not zod's JSON", () => {
		expect(() => validateAmount("abc")).toThrow(/^Amount must be/);
		expect(() => validateAddress("0x12")).toThrow(/^Invalid EVM address$/);
	});
});

describe("parseAmount", () => {
	it("converts to base units", () => {
		expect(parseAmount("1.5", 6)).toBe(1_500_000n);
	});

	it("refuses what it used to rewrite", () => {
		expect(() => parseAmount("1,5", 18)).toThrow(FibxError);
		// parseUnits would round this to 1.000001 USDC.
		expect(() => parseAmount("1.0000005", 6)).toThrow("more decimal places");
	});
});
