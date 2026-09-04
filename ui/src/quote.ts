import { MAX_POLL_ATTEMPTS } from "./status.js";

export type Hop = { protocol: number; displayName?: string; pool: string };

export type Quote = {
	fromToken: string;
	toToken: string;
	inputAmount: string;
	outputAmount: string;
	minReceived: string;
	slippage: number;
	usdIn: number;
	usdOut: number;
	priceImpact: number;
	route: Hop[];
	routerAddress: string;
	chain: string;
};

export type Severity = "ok" | "warn" | "bad";

/**
 * Price impact is an estimate derived from spot prices, so the thresholds are
 * about attention rather than precision: past one percent it is worth reading,
 * past five it is worth stopping for.
 */
export function formatImpact(impact: number): { text: string; severity: Severity } {
	const severity: Severity = impact >= 5 ? "bad" : impact >= 1 ? "warn" : "ok";
	return { text: `${impact.toFixed(2)}%`, severity };
}

export function routeLabel(hop: Hop): string {
	if (hop.displayName) return hop.displayName;
	return `${hop.pool.slice(0, 6)}…${hop.pool.slice(-4)}`;
}

/**
 * The full `get_quote` result envelope (src/mcp/handlers/quote.ts). Every
 * branch — a routed swap and the wrap/unwrap 1:1 conversions — shares
 * `input`/`output`/`rate`/`chain`; only a routed swap additionally nests
 * `quote`, because a 1:1 conversion has no route, no hops and no price
 * impact to describe.
 */
export type QuoteResult =
	| {
			input: string;
			output: string;
			rate: string;
			chain: string;
			operation: "wrap" | "unwrap";
	  }
	| {
			input: string;
			output: string;
			rate: string;
			chain: string;
			slippage: string;
			router: string;
			quote: Quote;
	  };

export function hasRoute(result: QuoteResult): result is Extract<QuoteResult, { quote: Quote }> {
	return "quote" in result;
}

/**
 * Wrap and unwrap results carry the amount and symbol pre-joined into one
 * prose string ("1 ETH") — there is no nested `quote` object for a 1:1
 * conversion to read separated fields off of. The handler only ever builds
 * this as `${amount} ${symbol}` with no thousands separators, so splitting on
 * the first space is exact, not a heuristic.
 */
export function splitAmountSymbol(s: string): { amount: string; symbol: string } {
	const i = s.indexOf(" ");
	if (i < 0) return { amount: s, symbol: "" };
	return { amount: s.slice(0, i), symbol: s.slice(i + 1) };
}

/**
 * The arguments `swap_tokens` needs, read from whichever shape `get_quote`
 * returned. A routed swap's nested `quote` object already separates
 * everything (that is exactly what Task 4 built it for); a wrap/unwrap result
 * has no such object, so its amount and symbols are split back out of the
 * prose strings instead. Slippage is meaningless for a 1:1 conversion, so it
 * is simply omitted there — the tool schema defaults it.
 */
export function buildSwapArgs(result: QuoteResult, simulate: boolean): Record<string, unknown> {
	const base = hasRoute(result)
		? {
				amount: result.quote.inputAmount,
				from_token: result.quote.fromToken,
				to_token: result.quote.toToken,
				chain: result.quote.chain,
				slippage: result.quote.slippage,
			}
		: (() => {
				const { amount, symbol: from_token } = splitAmountSymbol(result.input);
				const { symbol: to_token } = splitAmountSymbol(result.output);
				return { amount, from_token, to_token, chain: result.chain };
			})();
	return simulate ? { ...base, simulate: true } : base;
}

export type TxPollDecision =
	| { action: "poll"; attempt: number }
	| { action: "stop" }
	| { action: "expired" };

/**
 * `get_tx_status` calls viem's `getTransactionReceipt`, which throws until the
 * transaction is mined (src/mcp/handlers/wallet.ts's `handleGetTxStatus`), and
 * `callJson` (./rpc.js) turns both an `isError` result and a `{ success:
 * false }` body into a thrown error either way. So the caller of this
 * function cannot tell "not mined yet" from "the RPC call failed" — both look
 * identical, a throw — and must treat every one of them as pending rather
 * than as a failure. It passes `undefined` for that case. Only a status that
 * actually resolved to "confirmed" or "reverted" is terminal.
 *
 * NOT `nextPoll` from ./status.ts — that is typed for the WalletConnect
 * pairing shape (`ConnectStatus`), not a transaction status. This reuses only
 * `MAX_POLL_ATTEMPTS`, so both poll loops give up on the same schedule.
 */
export function nextTxPoll(status: string | undefined, attempt: number): TxPollDecision {
	if (status === "confirmed" || status === "reverted") return { action: "stop" };
	if (attempt >= MAX_POLL_ATTEMPTS) return { action: "expired" };
	return { action: "poll", attempt: attempt + 1 };
}
