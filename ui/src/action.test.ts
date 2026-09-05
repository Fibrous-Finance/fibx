import { describe, expect, it } from "vitest";
import { primaryAction } from "./action.js";
import type { QuoteResult } from "./quote.js";
import type { State } from "./machine.js";
import type { SimulateResult, Terms } from "./types.js";

const TERMS: Terms = { from: "ETH", to: "USDC", amount: "0.001", slippage: 0.5 };
const QUOTE = {
	input: "0.001 ETH",
	output: "~2.45 USDC",
	rate: "1 ETH ≈ 2450 USDC",
	chain: "base",
	slippage: "0.5%",
	router: "0xr",
	quote: {
		fromToken: "ETH",
		toToken: "USDC",
		inputAmount: "0.001",
		outputAmount: "2.45",
		minReceived: "2.43",
		slippage: 0.5,
		usdIn: 2.45,
		usdOut: 2.45,
		priceImpact: 0.02,
		route: [],
		routerAddress: "0xr",
		chain: "base",
	},
} satisfies QuoteResult;
const SIM: SimulateResult = {
	success: true,
	mode: "SIMULATION",
	amountIn: "0.001",
	amountOut: "2.45",
	tokenIn: "ETH",
	tokenOut: "USDC",
	chain: "base",
};
const AMOUNTS = { amountIn: "0.001", amountOut: "2.45", tokenIn: "ETH", tokenOut: "USDC" };
const EXPLAINED = { title: "It failed", severity: "error" as const };

/** Connected, funded, not fetching — so a test names only what it varies. */
function act(state: State, over: Partial<Parameters<typeof primaryAction>[0]> = {}) {
	return primaryAction({
		state,
		connected: true,
		amount: TERMS.amount,
		fromSymbol: "ETH",
		short: false,
		quoting: false,
		...over,
	});
}

describe("primaryAction", () => {
	// Nothing else on the card is actionable without a wallet, so this beats
	// every other reading of the state — including a terminal one.
	it("asks for a wallet before anything else", () => {
		expect(act({ kind: "quoted", terms: TERMS, quote: QUOTE }, { connected: false })).toEqual({
			intent: "connect",
			label: "Connect wallet",
			enabled: true,
		});
		expect(
			act(
				{ kind: "unknown", terms: TERMS, txHash: "0xh", amounts: AMOUNTS },
				{ connected: false }
			).intent
		).toBe("connect");
	});

	// A hash that never resolved is permanent: a transaction that may already
	// be in flight has no safe retry, and no shortfall or fresh quote may
	// re-arm the button.
	it("stays unresolved forever once a broadcast never resolved", () => {
		const state: State = { kind: "unknown", terms: TERMS, txHash: "0xh", amounts: AMOUNTS };
		expect(act(state)).toEqual({
			intent: "unresolved",
			label: "Unresolved — check the explorer",
			enabled: false,
		});
		expect(act(state, { short: true }).intent).toBe("unresolved");
		expect(act(state, { amount: "" }).intent).toBe("unresolved");
	});

	it("names the call that is in flight, and disables the button while it is", () => {
		expect(act({ kind: "simulating", terms: TERMS, quote: QUOTE })).toEqual({
			intent: "simulating",
			label: "Simulating…",
			enabled: false,
		});
		expect(act({ kind: "swapping", terms: TERMS, quote: QUOTE, sim: SIM })).toEqual({
			intent: "waiting",
			label: "Waiting for confirmation…",
			enabled: false,
		});
		expect(act({ kind: "broadcast", terms: TERMS, txHash: "0xh", amounts: AMOUNTS })).toEqual({
			intent: "waiting",
			label: "Waiting for confirmation…",
			enabled: false,
		});
	});

	it("offers a retry on a failure", () => {
		expect(
			act({
				kind: "failed",
				terms: TERMS,
				quote: QUOTE,
				explained: EXPLAINED,
				afterSwapAttempt: false,
			})
		).toEqual({ intent: "retry", label: "Try again", enabled: true });
	});

	it("offers another swap once one settled, either way", () => {
		expect(
			act({
				kind: "confirmed",
				terms: TERMS,
				txHash: "0xh",
				amounts: AMOUNTS,
				blockNumber: "1",
			})
		).toEqual({ intent: "swap-again", label: "Swap again", enabled: true });
		expect(
			act({ kind: "reverted", terms: TERMS, txHash: "0xh", amounts: AMOUNTS }).intent
		).toBe("swap-again");
	});

	it("asks for an amount when there is none, or when it is zero", () => {
		expect(act({ kind: "editing", terms: TERMS, quote: null }, { amount: "" })).toEqual({
			intent: "enter-amount",
			label: "Enter an amount",
			enabled: false,
		});
		expect(act({ kind: "quoted", terms: TERMS, quote: QUOTE }, { amount: "0" }).intent).toBe(
			"enter-amount"
		);
	});

	// The shortfall is the reason the swap cannot proceed, so it takes the
	// button from the quote that is otherwise ready — the raw
	// eth_estimateGas dump this replaced came from letting it through.
	it("names the shortfall over a ready quote", () => {
		expect(
			act({ kind: "quoted", terms: TERMS, quote: QUOTE }, { short: true, fromSymbol: "USDC" })
		).toEqual({ intent: "insufficient", label: "Insufficient USDC balance", enabled: false });
	});

	it("says a quote is being fetched", () => {
		expect(act({ kind: "editing", terms: TERMS, quote: null }, { quoting: true })).toEqual({
			intent: "quoting",
			label: "Fetching quote…",
			enabled: false,
		});
	});

	// The gate: the same button, pressed twice, in order.
	it("offers Simulate on a quote and Swap only on a simulate that succeeded", () => {
		expect(act({ kind: "quoted", terms: TERMS, quote: QUOTE })).toEqual({
			intent: "simulate",
			label: "Simulate",
			enabled: true,
		});
		expect(act({ kind: "simulated", terms: TERMS, quote: QUOTE, sim: SIM })).toEqual({
			intent: "swap",
			label: "Swap",
			enabled: true,
		});
	});

	// Nothing is quoted and nothing is in flight: an amount is what is
	// missing, whatever the field currently holds.
	it("falls back to asking for an amount when there is no quote", () => {
		expect(act({ kind: "editing", terms: TERMS, quote: null })).toEqual({
			intent: "enter-amount",
			label: "Enter an amount",
			enabled: false,
		});
	});
});
