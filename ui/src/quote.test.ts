import { describe, expect, it } from "vitest";
import {
	buildSwapArgs,
	formatImpact,
	hasRoute,
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
		expect(formatImpact(1.4).severity).toBe("warn");
	});

	it("alarms past five", () => {
		expect(formatImpact(7.2).severity).toBe("bad");
	});

	// A route can price better than spot; showing "-0.10%" as a loss would be
	// backwards.
	it("keeps a negative impact negative", () => {
		expect(formatImpact(-0.1).text).toBe("-0.10%");
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

	// Reuses the wallet-panel's own ceiling rather than a second invented
	// number, so both poll loops give up on the same schedule.
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
