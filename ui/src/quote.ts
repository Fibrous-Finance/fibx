import { MAX_POLL_ATTEMPTS } from "./status.js";

export type Hop = { protocol: number; displayName?: string; pool: string };

export type Quote = {
	fromToken: string;
	toToken: string;
	inputAmount: string;
	outputAmount: string;
	minReceived: string;
	slippage: number;
	// Null where the route carried no usable price for that token. A missing
	// price used to arrive here as 0, which the form drew as "$0.00" beneath a
	// real amount and — through price impact's zero branch — as a green
	// "0.00%" pill, a fabricated safety signal on the one number that exists to
	// make a user stop. Absent is now absent.
	usdIn: number | null;
	usdOut: number | null;
	priceImpact: number | null;
	route: Hop[];
	routerAddress: string;
	chain: string;
};

export type Severity = "ok" | "warn" | "bad";

/**
 * Price impact is an estimate derived from spot prices, so the thresholds are
 * about attention rather than precision: past one percent it is worth reading,
 * past five it is worth stopping for.
 *
 * Returns null when there is no impact to describe — `get_quote` sends null
 * whenever either side's price was missing. A caller must render that as an
 * explicit unknown and NOT as a severity, because a colour on an absent
 * number is a claim the app cannot back.
 */
export function formatImpact(
	impact: number | null | undefined
): { text: string; severity: Severity } | null {
	if (typeof impact !== "number" || !Number.isFinite(impact)) return null;
	const severity: Severity = impact >= 5 ? "bad" : impact >= 1 ? "warn" : "ok";
	return { text: `${impact.toFixed(2)}%`, severity };
}

/**
 * A USD value the app can stand behind, or an explicit dash. Rendering an
 * absent price as "$0.00" puts a number under a real amount that nothing
 * supports; a dash says what is actually true.
 */
export function formatUsd(value: number | null | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return "—";
	return `$${value.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

/**
 * An amount at reading length. A route answers with the token's full
 * precision — "0.000099679682043379" for a native balance — which pushes the
 * token button off the card when drawn whole, and `toPrecision` answers
 * "9.96797e-5", which stops being an amount at all. Six significant digits
 * past the leading zeros, no trailing zeros, never an exponent.
 *
 * Display only. Every amount that reaches a tool call is the string the user
 * typed or the one the route returned, never this.
 */
export function formatAmountShort(s: string, significant = 6): string {
	const n = Number(s);
	// Number("") is 0, and drawing "0" where the server sent nothing would be
	// an invented balance.
	if (s.trim() === "" || !Number.isFinite(n)) return s;
	if (n === 0) return "0";
	const magnitude = Math.floor(Math.log10(Math.abs(n)));
	const decimals = Math.min(Math.max(0, significant - 1 - magnitude), 100);
	const fixed = n.toFixed(decimals);
	// toFixed gives up on exponents past 1e21 — far above any token amount,
	// but the raw string is still better than "1e+21" in an amount field.
	if (fixed.includes("e")) return s;
	return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/**
 * The highest slippage the swap form will send. Slippage is the floor on what the
 * user receives: `swap_tokens` derives the on-chain `min_received` from this
 * same number, and the local signing policy cannot catch a bad one — its
 * `maxValue` bounds native value only, so an ERC-20 swap reaches the router
 * with `value: 0n` and the cap never sees the amount. A fat-fingered "5"
 * becoming "50" would collapse the floor with nothing in the way.
 *
 * The tool schema carries its own, wider bound (src/mcp/tools/trade.ts). This
 * is not a substitute for that one: the model calls the schema directly,
 * never passing through the swap form.
 */
export const MAX_SLIPPAGE_PERCENT = 5;

export type SlippageCheck = { ok: true; slippage: number } | { ok: false; message: string };

/**
 * Refuse rather than clamp. Silently rewriting the number the user typed
 * would leave them believing the swap runs on terms it does not.
 */
export function checkSlippage(raw: string): SlippageCheck {
	const slippage = Number(raw);
	if (!Number.isFinite(slippage) || slippage <= 0) {
		return { ok: false, message: "Slippage must be a positive number." };
	}
	if (slippage > MAX_SLIPPAGE_PERCENT) {
		return {
			ok: false,
			message: `Slippage above ${MAX_SLIPPAGE_PERCENT}% is refused — it is the floor on what you receive, and the swap would send it on-chain. Enter ${MAX_SLIPPAGE_PERCENT} or less.`,
		};
	}
	return { ok: true, slippage };
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
