import { describe, expect, it } from "vitest";
import { canSwap, initialState, isLocked, transition, type State } from "./machine.js";
import type { Explained } from "./errors.js";
import type { QuoteResult } from "./quote.js";
import type { SimulateResult } from "./types.js";

const TERMS = { from: "ETH", to: "USDC", amount: "0.001", slippage: 0.5 };
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
	mode: "SIMULATION (no TX sent)",
	amountIn: "0.001",
	amountOut: "2.45",
	tokenIn: "ETH",
	tokenOut: "USDC",
	chain: "base",
	requiresApproval: false,
};
const TX = { txHash: "0xabc", explorer: "https://x/tx/0xabc" };
// The machine never re-explains: whatever `explainError` produced at the catch
// site is what `failed` holds. These stand in for one.
const REJECTED: Explained = {
	title: "Rejected in your wallet",
	detail: "Nothing was sent.",
	severity: "warning",
};
const SHORT: Explained = { title: "Insufficient balance", severity: "error" };

function quoted(): State {
	return transition(initialState(TERMS), { type: "QUOTE_ARRIVED", quote: QUOTE });
}
function simulated(): State {
	return transition(transition(quoted(), { type: "SIMULATE" }), { type: "SIMULATED", sim: SIM });
}
function broadcast(): State {
	return transition(transition(simulated(), { type: "SWAP" }), {
		type: "BROADCAST",
		...TX,
		amounts: { amountIn: "0.001", amountOut: "2.45", tokenIn: "ETH", tokenOut: "USDC" },
	});
}

describe("the happy path", () => {
	it("starts editing with the given terms and no quote", () => {
		const s = initialState(TERMS);
		expect(s.kind).toBe("editing");
		expect(s.terms).toEqual(TERMS);
		expect(canSwap(s)).toBe(false);
	});

	it("becomes quoted when a quote arrives", () => {
		expect(quoted().kind).toBe("quoted");
	});

	// Swap is gated on a simulate that succeeded for exactly these terms: the
	// two-transactions disclosure lives only in the simulate result.
	it("unlocks Swap only after a successful simulate", () => {
		expect(canSwap(quoted())).toBe(false);
		expect(canSwap(simulated())).toBe(true);
	});

	it("reaches confirmed on a confirmed receipt", () => {
		const s = transition(broadcast(), {
			type: "RECEIPT",
			status: "confirmed",
			blockNumber: "1",
		});
		expect(s.kind).toBe("confirmed");
	});
});

describe("invalidation", () => {
	it("any change to the terms after a simulate returns to editing and locks Swap", () => {
		const s = transition(simulated(), {
			type: "TERMS_CHANGED",
			terms: { ...TERMS, amount: "1" },
		});
		expect(s.kind).toBe("editing");
		expect(canSwap(s)).toBe(false);
	});

	it("a new quote after a simulate returns to quoted, not simulated", () => {
		const s = transition(simulated(), { type: "QUOTE_ARRIVED", quote: QUOTE });
		expect(s.kind).toBe("quoted");
		expect(canSwap(s)).toBe(false);
	});
});

describe("locking", () => {
	// A hash exists and never resolved. Nothing may leave this state: a
	// re-quote or a second simulate would silently re-arm Swap on a transaction
	// that may already be in flight.
	it("unknown is terminal — ignores every event", () => {
		const unknown = transition(broadcast(), { type: "POLL_EXPIRED" });
		expect(unknown.kind).toBe("unknown");
		expect(isLocked(unknown)).toBe(true);
		for (const ev of [
			{ type: "TERMS_CHANGED", terms: TERMS },
			{ type: "QUOTE_ARRIVED", quote: QUOTE },
			{ type: "SIMULATE" },
			{ type: "SWAP" },
		] as const) {
			expect(transition(unknown, ev)).toBe(unknown);
		}
	});

	it("locks while simulating, swapping and broadcast", () => {
		expect(isLocked(transition(quoted(), { type: "SIMULATE" }))).toBe(true);
		expect(isLocked(transition(simulated(), { type: "SWAP" }))).toBe(true);
		expect(isLocked(broadcast())).toBe(true);
	});

	it("a terms change while locked is ignored", () => {
		const b = broadcast();
		expect(transition(b, { type: "TERMS_CHANGED", terms: { ...TERMS, amount: "9" } })).toBe(b);
	});

	// Confirmed and reverted are done. Editing again starts a new swap and is
	// allowed; the old hash is simply gone from the state.
	it("confirmed and reverted unlock on a terms change", () => {
		const confirmed = transition(broadcast(), {
			type: "RECEIPT",
			status: "confirmed",
			blockNumber: "1",
		});
		const next = transition(confirmed, { type: "TERMS_CHANGED", terms: TERMS });
		expect(next.kind).toBe("editing");
	});
});

describe("failure", () => {
	it("a simulate failure is not after a swap attempt", () => {
		const s = transition(transition(quoted(), { type: "SIMULATE" }), {
			type: "SIMULATE_FAILED",
			explained: SHORT,
		});
		expect(s.kind).toBe("failed");
		expect(s.kind === "failed" && s.afterSwapAttempt).toBe(false);
	});

	// The approval leg may already be on chain when the swap leg throws.
	it("a swap failure is after a swap attempt", () => {
		const s = transition(transition(simulated(), { type: "SWAP" }), {
			type: "SWAP_FAILED",
			explained: REJECTED,
		});
		expect(s.kind === "failed" && s.afterSwapAttempt).toBe(true);
		// The explanation travels whole. Nothing re-derives it downstream.
		expect(s.kind === "failed" && s.explained).toBe(REJECTED);
	});

	it("failed keeps the quote so the form still draws", () => {
		const s = transition(transition(quoted(), { type: "SIMULATE" }), {
			type: "SIMULATE_FAILED",
			explained: SHORT,
		});
		expect(s.kind === "failed" && s.quote).toEqual(QUOTE);
	});
});
