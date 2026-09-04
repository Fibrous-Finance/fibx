import type { QuoteResult } from "./quote.js";
import type { SimulateResult, Terms } from "./types.js";

export type Amounts = { amountIn: string; amountOut: string; tokenIn: string; tokenOut: string };

export type State =
	| { kind: "editing"; terms: Terms; quote: QuoteResult | null }
	| { kind: "quoted"; terms: Terms; quote: QuoteResult }
	| { kind: "simulating"; terms: Terms; quote: QuoteResult }
	| { kind: "simulated"; terms: Terms; quote: QuoteResult; sim: SimulateResult }
	| { kind: "swapping"; terms: Terms; quote: QuoteResult; sim: SimulateResult }
	| { kind: "broadcast"; terms: Terms; txHash: string; explorer?: string; amounts: Amounts }
	| {
			kind: "confirmed";
			terms: Terms;
			txHash: string;
			explorer?: string;
			amounts: Amounts;
			blockNumber: string;
	  }
	| { kind: "reverted"; terms: Terms; txHash: string; explorer?: string; amounts: Amounts }
	// A hash exists and never resolved. Terminal: see isLocked.
	| { kind: "unknown"; terms: Terms; txHash: string; explorer?: string; amounts: Amounts }
	// No hash came back. `afterSwapAttempt` marks that an ERC-20 approval may
	// nonetheless be on chain: handleSwapTokens sends it before the swap.
	| {
			kind: "failed";
			terms: Terms;
			quote: QuoteResult | null;
			message: string;
			afterSwapAttempt: boolean;
	  };

export type Event =
	| { type: "TERMS_CHANGED"; terms: Terms }
	| { type: "QUOTE_ARRIVED"; quote: QuoteResult }
	| { type: "QUOTE_FAILED"; message: string }
	| { type: "SIMULATE" }
	| { type: "SIMULATED"; sim: SimulateResult }
	| { type: "SIMULATE_FAILED"; message: string }
	| { type: "SWAP" }
	| { type: "BROADCAST"; txHash: string; explorer?: string; amounts: Amounts }
	| { type: "SWAP_FAILED"; message: string }
	| { type: "RECEIPT"; status: "confirmed" | "reverted"; blockNumber: string; explorer?: string }
	| { type: "POLL_EXPIRED" };

export function initialState(terms: Terms, quote: QuoteResult | null = null): State {
	return quote ? { kind: "quoted", terms, quote } : { kind: "editing", terms, quote: null };
}

/**
 * Nothing the user does may change the state: a call is in flight, or a hash
 * exists whose outcome is not known. `unknown` stays locked forever — there is
 * no safe retry for a transaction that may already be in flight, and a
 * re-quote or a second simulate would silently re-arm Swap.
 */
export function isLocked(s: State): boolean {
	return (
		s.kind === "simulating" ||
		s.kind === "swapping" ||
		s.kind === "broadcast" ||
		s.kind === "unknown"
	);
}

/** Swap is allowed only on a simulate that succeeded for the current terms. */
export function canSwap(s: State): boolean {
	return s.kind === "simulated";
}

function quoteOf(s: State): QuoteResult | null {
	return "quote" in s ? s.quote : null;
}

/**
 * Pure. Returns the SAME object when an event does not apply, so a caller (and
 * a test) can tell "ignored" from "re-entered the same kind".
 */
export function transition(s: State, ev: Event): State {
	if (isLocked(s)) {
		// Only the events that end the in-flight operation apply.
		switch (s.kind) {
			case "simulating":
				if (ev.type === "SIMULATED")
					return { kind: "simulated", terms: s.terms, quote: s.quote, sim: ev.sim };
				if (ev.type === "SIMULATE_FAILED")
					return {
						kind: "failed",
						terms: s.terms,
						quote: s.quote,
						message: ev.message,
						afterSwapAttempt: false,
					};
				return s;
			case "swapping":
				if (ev.type === "BROADCAST")
					return {
						kind: "broadcast",
						terms: s.terms,
						txHash: ev.txHash,
						explorer: ev.explorer,
						amounts: ev.amounts,
					};
				if (ev.type === "SWAP_FAILED")
					return {
						kind: "failed",
						terms: s.terms,
						quote: s.quote,
						message: ev.message,
						afterSwapAttempt: true,
					};
				return s;
			case "broadcast":
				if (ev.type === "RECEIPT") {
					const base = {
						terms: s.terms,
						txHash: s.txHash,
						explorer: ev.explorer ?? s.explorer,
						amounts: s.amounts,
					};
					return ev.status === "confirmed"
						? { kind: "confirmed", ...base, blockNumber: ev.blockNumber }
						: { kind: "reverted", ...base };
				}
				if (ev.type === "POLL_EXPIRED")
					return {
						kind: "unknown",
						terms: s.terms,
						txHash: s.txHash,
						explorer: s.explorer,
						amounts: s.amounts,
					};
				return s;
			case "unknown":
				return s;
		}
	}

	switch (ev.type) {
		case "TERMS_CHANGED":
			return { kind: "editing", terms: ev.terms, quote: null };
		case "QUOTE_ARRIVED":
			return { kind: "quoted", terms: s.terms, quote: ev.quote };
		case "QUOTE_FAILED":
			return {
				kind: "failed",
				terms: s.terms,
				quote: null,
				message: ev.message,
				afterSwapAttempt: false,
			};
		case "SIMULATE": {
			const quote = quoteOf(s);
			if (!quote) return s;
			return { kind: "simulating", terms: s.terms, quote };
		}
		case "SWAP":
			if (s.kind !== "simulated") return s;
			return { kind: "swapping", terms: s.terms, quote: s.quote, sim: s.sim };
		default:
			return s;
	}
}
