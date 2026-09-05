import { describe, expect, it } from "vitest";
import {
	buildSwapArgs,
	checkSlippage,
	formatAmountShort,
	formatImpact,
	formatUsd,
	hasRoute,
	MAX_SLIPPAGE_PERCENT,
	nextTxPoll,
	routeLabel,
	splitAmountSymbol,
	type QuoteResult,
} from "./quote.js";
import { MAX_POLL_ATTEMPTS } from "./status.js";

describe("formatImpact", () => {
	it("reads a small loss as ordinary", () => {
		expect(formatImpact(0.3)).toEqual({ text: "0.30%", severity: "ok" });
	});

	// Past a point the number stops being trivia and becomes the reason not to
	// swap, so it has to look different.
	it("warns past one percent", () => {
		expect(formatImpact(1.4)?.severity).toBe("warn");
	});

	it("alarms past five", () => {
		expect(formatImpact(7.2)?.severity).toBe("bad");
	});

	// A route can price better than spot; showing "-0.10%" as a loss would be
	// backwards.
	it("keeps a negative impact negative", () => {
		expect(formatImpact(-0.1)?.text).toBe("-0.10%");
	});

	// get_quote sends null when either token's price was missing. Returning a
	// severity here would put a colour — green at 0, red at 100 — on a number
	// nothing supports, which is the failure this replaced. There is no
	// number, so there is no pill.
	it("has nothing to say about an absent impact", () => {
		expect(formatImpact(null)).toBeNull();
		expect(formatImpact(undefined)).toBeNull();
	});
});

describe("formatUsd", () => {
	// A four-figure price with no separator is one long digit run at a glance,
	// on the one line a user reads to decide whether the trade is the size
	// they meant.
	it("formats a value it can stand behind, grouped in thousands", () => {
		expect(formatUsd(4000)).toBe("$4,000.00");
		expect(formatUsd(2454.11)).toBe("$2,454.11");
		expect(formatUsd(0.25)).toBe("$0.25");
	});

	// "$0.00" beneath a real amount is a number the app cannot justify. The
	// dash says what is true instead.
	it("renders an absent value as an explicit dash", () => {
		expect(formatUsd(null)).toBe("—");
		expect(formatUsd(undefined)).toBe("—");
	});
});

// A route answers with the token's full precision — eighteen decimals on a
// native balance. Drawn whole that pushes the token button off the card;
// drawn through toPrecision it becomes "9.96797e-5", which is not an amount.
describe("formatAmountShort", () => {
	it("keeps six significant digits past the leading zeros", () => {
		expect(formatAmountShort("0.000099679682043379")).toBe("0.0000996797");
	});

	it("rounds a plain decimal to six significant digits", () => {
		expect(formatAmountShort("2.453625")).toBe("2.45363");
	});

	it("drops the trailing zeros a fixed width would add", () => {
		expect(formatAmountShort("1")).toBe("1");
		expect(formatAmountShort("2.45")).toBe("2.45");
		expect(formatAmountShort("0.0002")).toBe("0.0002");
	});

	it("reads zero as zero", () => {
		expect(formatAmountShort("0")).toBe("0");
	});

	it("never answers in exponent notation", () => {
		expect(formatAmountShort("0.000000000123456789")).toBe("0.000000000123457");
		expect(formatAmountShort("1e-7")).toBe("0.0000001");
	});

	// An empty string is Number 0, and drawing "0" where the server sent
	// nothing would be an invented balance. Anything unreadable travels
	// through untouched instead.
	it("hands back what it cannot read as a number", () => {
		expect(formatAmountShort("")).toBe("");
		expect(formatAmountShort("unknown")).toBe("unknown");
	});
});

// Slippage is the floor on what the user receives — swap_tokens derives the
// on-chain min_received from it — and the local signing policy cannot catch a
// bad one, because maxValue bounds native value only and an ERC-20 swap
// reaches the router with value: 0n.
describe("checkSlippage", () => {
	it("accepts an ordinary slippage", () => {
		expect(checkSlippage("0.5")).toEqual({ ok: true, slippage: 0.5 });
	});

	it("accepts the limit itself", () => {
		expect(checkSlippage(String(MAX_SLIPPAGE_PERCENT))).toEqual({
			ok: true,
			slippage: MAX_SLIPPAGE_PERCENT,
		});
	});

	// The fat-finger this exists for: a "5" that became a "50" would collapse
	// the floor to almost nothing, and nothing downstream would notice.
	it("refuses a fat-fingered 50", () => {
		const result = checkSlippage("50");
		expect(result.ok).toBe(false);
	});

	// Refuse, do not clamp: silently rewriting the number would leave the user
	// believing the swap runs on terms it does not. So the message has to name
	// the limit.
	it("says what the limit is rather than quietly clamping", () => {
		const result = checkSlippage("50");
		expect(result.ok === false && result.message).toContain(String(MAX_SLIPPAGE_PERCENT));
	});

	it("still refuses a non-number and a non-positive number", () => {
		expect(checkSlippage("abc").ok).toBe(false);
		expect(checkSlippage("").ok).toBe(false);
		expect(checkSlippage("0").ok).toBe(false);
		expect(checkSlippage("-1").ok).toBe(false);
	});
});

describe("routeLabel", () => {
	it("prefers the protocol's name", () => {
		expect(routeLabel({ protocol: 1, displayName: "Uniswap V3", pool: "0xabcdef1234" })).toBe(
			"Uniswap V3"
		);
	});

	// Without a name the pool is the only honest identifier, shortened so a
	// row of hops still fits.
	it("falls back to a shortened pool address", () => {
		expect(routeLabel({ protocol: 7, pool: "0xabcdef1234567890" })).toBe("0xabcd…7890");
	});
});

// get_tx_status's handler calls viem's getTransactionReceipt, which throws
// until the transaction is mined (src/mcp/handlers/wallet.ts) — so callJson
// throwing during a poll means "not mined yet", not "the swap failed". The
// caller passes `undefined` for that case; only a resolved "confirmed" or
// "reverted" status is terminal.
describe("nextTxPoll", () => {
	it("keeps polling on an unmined receipt (the call threw)", () => {
		expect(nextTxPoll(undefined, 0)).toEqual({ action: "poll", attempt: 1 });
	});

	it("stops once confirmed", () => {
		expect(nextTxPoll("confirmed", 5).action).toBe("stop");
	});

	it("stops once reverted", () => {
		expect(nextTxPoll("reverted", 5).action).toBe("stop");
	});

	// Reuses the pairing loop's own ceiling (status.ts) rather than a second
	// invented number, so both poll loops give up on the same schedule.
	it("gives up after the shared attempt ceiling", () => {
		expect(nextTxPoll(undefined, MAX_POLL_ATTEMPTS).action).toBe("expired");
	});
});

describe("hasRoute", () => {
	it("is true for a routed swap (a nested quote object)", () => {
		const result: QuoteResult = {
			input: "1 ETH",
			output: "~3960 USDC",
			rate: "1 ETH ≈ 3960 USDC",
			chain: "base",
			slippage: "0.5%",
			router: "0xrouter",
			quote: {
				fromToken: "ETH",
				toToken: "USDC",
				inputAmount: "1",
				outputAmount: "3960",
				minReceived: "3920.4",
				slippage: 0.5,
				usdIn: 4000,
				usdOut: 3960,
				priceImpact: 1,
				route: [],
				routerAddress: "0xrouter",
				chain: "base",
			},
		};
		expect(hasRoute(result)).toBe(true);
	});

	it("is false for a wrap/unwrap 1:1 conversion (no route to describe)", () => {
		const result: QuoteResult = {
			input: "1 ETH",
			output: "1 WETH",
			rate: "1 ETH = 1 WETH",
			chain: "base",
			operation: "wrap",
		};
		expect(hasRoute(result)).toBe(false);
	});
});

describe("splitAmountSymbol", () => {
	// The handler only ever builds this as `${amount} ${symbol}` with no
	// thousands separators (src/mcp/handlers/quote.ts), so splitting on the
	// first space is exact, not a heuristic.
	it("splits an amount from its trailing symbol", () => {
		expect(splitAmountSymbol("1 ETH")).toEqual({ amount: "1", symbol: "ETH" });
	});

	it("keeps a decimal amount intact", () => {
		expect(splitAmountSymbol("0.025 WETH")).toEqual({ amount: "0.025", symbol: "WETH" });
	});
});

describe("buildSwapArgs", () => {
	const routed: QuoteResult = {
		input: "1 ETH",
		output: "~3960 USDC",
		rate: "1 ETH ≈ 3960 USDC",
		chain: "base",
		slippage: "0.5%",
		router: "0xrouter",
		quote: {
			fromToken: "ETH",
			toToken: "USDC",
			inputAmount: "1",
			outputAmount: "3960",
			minReceived: "3920.4",
			slippage: 0.5,
			usdIn: 4000,
			usdOut: 3960,
			priceImpact: 1,
			route: [],
			routerAddress: "0xrouter",
			chain: "base",
		},
	};

	// The nested `quote` object is exactly what Task 4 built for this: clean,
	// separated fields, so a routed swap never needs to parse prose.
	it("reads amount, symbols, chain and slippage off the nested quote", () => {
		expect(buildSwapArgs(routed, false)).toEqual({
			amount: "1",
			from_token: "ETH",
			to_token: "USDC",
			chain: "base",
			slippage: 0.5,
		});
	});

	it("adds simulate:true when asked", () => {
		expect(buildSwapArgs(routed, true)).toEqual({
			amount: "1",
			from_token: "ETH",
			to_token: "USDC",
			chain: "base",
			slippage: 0.5,
			simulate: true,
		});
	});

	// A wrap/unwrap result carries no `quote` object — the amount and symbol
	// arrive pre-joined into one prose string, so this is the one path that
	// has to split it back apart.
	it("splits the prose input/output for a wrap or unwrap result", () => {
		const wrap: QuoteResult = {
			input: "1 ETH",
			output: "1 WETH",
			rate: "1 ETH = 1 WETH",
			chain: "base",
			operation: "wrap",
		};
		expect(buildSwapArgs(wrap, false)).toEqual({
			amount: "1",
			from_token: "ETH",
			to_token: "WETH",
			chain: "base",
		});
	});
});
