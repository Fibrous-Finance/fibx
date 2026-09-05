import { useEffect, useRef, useState } from "preact/hooks";
import type { App } from "@modelcontextprotocol/ext-apps";
import { callJson } from "./rpc.js";
import { explainError, type Explained } from "./errors.js";
import { shortAddress } from "./status.js";
import {
	buildSwapArgs,
	checkSlippage,
	formatAmountShort,
	formatImpact,
	formatUsd,
	hasRoute,
	nextTxPoll,
	routeLabel,
	type QuoteResult,
} from "./quote.js";
import { primaryAction } from "./action.js";
import { isLocked, initialState, transition, type Event, type State } from "./machine.js";
import type { BroadcastResult, SimulateResult, Terms, TxStatusResult } from "./types.js";

const DEBOUNCE_MS = 400;

/**
 * Tell the model what just happened on this card. Fire-and-forget on
 * purpose — informing the model is not part of the swap, and a host that
 * refuses the call must not break the form, so nothing is awaited and no
 * state is set from it. Ported from swap-card.tsx:86-88.
 */
function tellModel(app: App, text: string): void {
	void app.updateModelContext({ content: [{ type: "text", text }] }).catch(() => {});
}

/** The quote the machine is currently holding, or null in a kind that carries none. */
function quoteOf(s: State): QuoteResult | null {
	return "quote" in s ? s.quote : null;
}

/** A USD value, or an explicit dash where the route carried no price. */
function UsdValue({ value }: { value: number | null }) {
	return (
		<span title={value === null ? "No price for this token — USD value unknown." : undefined}>
			{value === null ? "—" : `~${formatUsd(value)}`}
		</span>
	);
}

export function SwapForm({
	app,
	chain,
	terms,
	quote,
	quoteError,
	balances,
	connected,
	onPickToken,
	onConnect,
	onPolicyRefusal,
	onSettled,
}: {
	app: App;
	chain: string;
	terms: Terms;
	quote: QuoteResult | null;
	quoteError?: string | null;
	balances: Record<string, string> | null;
	connected: boolean;
	/** The shell opens the picker; the form only says which side. */
	onPickToken: (side: "from" | "to") => void;
	/** The shell opens the pairing view. Without a wallet the primary button
	 *  is the only thing on this card worth pressing, so it is what asks. */
	onConnect?: () => void;
	onPolicyRefusal?: () => void;
	/** A receipt arrived — confirmed or reverted. The balance the shell handed
	 *  down is stale from here on, and the shortfall guard below computes
	 *  against it, so the shell is told to re-read it. */
	onSettled?: () => void;
}) {
	// A snapshot that arrived with a quoteError (the model asked for a quote on
	// a token that could not be resolved) starts the form already explaining
	// it — computed here, in the initializer, rather than in an effect, so it
	// is on screen at the very first render with nothing to await.
	const [state, setState] = useState<State>(() => {
		const seeded = initialState(terms, quote);
		return quoteError
			? transition(seeded, {
					type: "QUOTE_FAILED",
					explained: explainError(new Error(quoteError), {
						symbol: terms.from,
						amount: terms.amount,
						balance: balances?.[terms.from],
					}),
				})
			: seeded;
	});
	// The last non-null quote this card held. `broadcast`, `confirmed`,
	// `reverted` and `unknown` carry `amounts` but no `quote` — without this,
	// the rate chip, the detail line and the box USD/impact meta vanish the
	// instant Swap is pressed, which is exactly when the user most wants to
	// see what they committed to. Cleared only on TERMS_CHANGED (a genuine new
	// pair or a fresh requote), so a new quote request never shows a stale
	// rate while it is in flight.
	const lastQuote = useRef<QuoteResult | null>(null);
	const dispatch = (ev: Event) => {
		if (ev.type === "TERMS_CHANGED") lastQuote.current = null;
		setState((s) => transition(s, ev));
	};

	const [slippageDraft, setSlippageDraft] = useState(() => String(terms.slippage));
	const [slippageError, setSlippageError] = useState<string | null>(null);
	const [explorerLinkOk, setExplorerLinkOk] = useState(true);
	// The debounce and the call after it, as one visible fact. The machine has
	// no "fetching" kind — `editing` covers a typed amount whether or not a
	// call is out — so this lives beside it rather than in it.
	const [quoting, setQuoting] = useState(false);

	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// The poll loop below (and any in-flight quote/simulate/swap call) can
	// outlive this component — the shell swaps it out for the picker, or the
	// host tears the iframe down. Checked after every await, before any
	// dispatch. tellModel sets no state, so it needs no such guard.
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	// The initializer above already handles the very first render (including
	// the quoteError case); this only reacts to the shell re-seeding terms or
	// quote afterwards — a picker choice or a chain change.
	const firstRun = useRef(true);
	useEffect(() => {
		if (firstRun.current) {
			firstRun.current = false;
			return;
		}
		dispatch({ type: "TERMS_CHANGED", terms });
		if (quote) dispatch({ type: "QUOTE_ARRIVED", quote });
		// A picked token or a changed chain nulls the shell's quote, and
		// nothing else would ask for a new one: "You Receive" sat at — until
		// the user retyped the amount. The debounce is the same one a
		// keystroke uses, so a burst of re-seeds costs one call.
		else if (terms.amount !== "") scheduleQuote(terms);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [terms, quote]);

	// Sync the slippage draft to the machine's terms whenever they change from
	// something other than the user's own (possibly still-invalid) typing —
	// an external re-seed, or a flip. An invalid keystroke never reaches
	// state.terms, so this effect does not overwrite it mid-edit.
	useEffect(() => {
		setSlippageDraft(String(state.terms.slippage));
	}, [state.terms.slippage]);

	const currentQuote = quoteOf(state);
	// Remembers the current quote the moment the machine carries one, so it
	// survives into the four states that do not.
	useEffect(() => {
		if (currentQuote) lastQuote.current = currentQuote;
	}, [currentQuote]);
	const displayQuote = currentQuote ?? lastQuote.current;
	const locked = isLocked(state);
	const liveTerms = state.terms;

	// A balances map that came back at all is complete: get_balance omits an
	// ERC-20 the wallet holds none of, so a missing key is zero, not unknown.
	// Reading it as unknown let a zero-balance token past this guard and into
	// swap_tokens — the eth_estimateGas dump the spec opens with. `null`
	// (not authenticated, or the read failed) is still unknown.
	const held = balances ? (balances[liveTerms.from] ?? "0") : undefined;
	const short = connected && held !== undefined && Number(liveTerms.amount) > Number(held);

	/**
	 * The one place a raw error becomes an explanation. It is mapped once, here,
	 * and the whole `Explained` is what the machine carries: a title fed back
	 * through `explainError` matches nothing and loses the detail, the action
	 * and the severity that made it useful.
	 */
	function explain(e: unknown, t: Terms): Explained {
		return explainError(e, { symbol: t.from, amount: t.amount, balance: balances?.[t.from] });
	}

	function scheduleQuote(nextTerms: Terms) {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		setQuoting(true);
		debounceRef.current = setTimeout(() => {
			void fetchQuote(nextTerms);
		}, DEBOUNCE_MS);
	}

	async function fetchQuote(nextTerms: Terms) {
		try {
			const result = await callJson<QuoteResult>(app, "get_quote", {
				amount: nextTerms.amount,
				from_token: nextTerms.from,
				to_token: nextTerms.to,
				chain,
				slippage: nextTerms.slippage,
			});
			if (!alive.current) return;
			setQuoting(false);
			dispatch({ type: "QUOTE_ARRIVED", quote: result });
			// The seeded quote (the one the shell opened with) does not
			// announce itself — only a quote that arrived from the user's own
			// edit does, because the model otherwise still believes the
			// amounts it was first shown.
			if (hasRoute(result)) {
				tellModel(
					app,
					`Quote in the FibX app: ${result.quote.inputAmount} ${result.quote.fromToken} → ${result.quote.outputAmount} ${result.quote.toToken} on ${result.quote.chain}, ${result.quote.route.length} hop(s). Not swapped.`
				);
			}
		} catch (e) {
			if (!alive.current) return;
			setQuoting(false);
			dispatch({ type: "QUOTE_FAILED", explained: explain(e, nextTerms) });
		}
	}

	function editAmount(value: string) {
		const nextTerms = { ...liveTerms, amount: value };
		dispatch({ type: "TERMS_CHANGED", terms: nextTerms });
		scheduleQuote(nextTerms);
	}

	function editSlippage(value: string) {
		setSlippageDraft(value);
		const checked = checkSlippage(value);
		if (!checked.ok) {
			setSlippageError(checked.message);
			return;
		}
		setSlippageError(null);
		const nextTerms = { ...liveTerms, slippage: checked.slippage };
		dispatch({ type: "TERMS_CHANGED", terms: nextTerms });
		scheduleQuote(nextTerms);
	}

	function flip() {
		const destAmount =
			currentQuote && hasRoute(currentQuote) ? currentQuote.quote.outputAmount : undefined;
		const nextTerms: Terms = {
			from: liveTerms.to,
			to: liveTerms.from,
			amount: destAmount ?? liveTerms.amount,
			slippage: liveTerms.slippage,
		};
		dispatch({ type: "TERMS_CHANGED", terms: nextTerms });
		scheduleQuote(nextTerms);
	}

	async function simulate() {
		if (!currentQuote) return;
		dispatch({ type: "SIMULATE" });
		try {
			const result = await callJson<SimulateResult>(
				app,
				"swap_tokens",
				buildSwapArgs(currentQuote, true)
			);
			if (!alive.current) return;
			dispatch({ type: "SIMULATED", sim: result });
		} catch (e) {
			if (!alive.current) return;
			const explained = explain(e, liveTerms);
			if (explained.action === "policy") onPolicyRefusal?.();
			dispatch({ type: "SIMULATE_FAILED", explained });
		}
	}

	async function swap() {
		if (!currentQuote) return;
		dispatch({ type: "SWAP" });
		let broadcast: BroadcastResult;
		try {
			broadcast = await callJson<BroadcastResult>(
				app,
				"swap_tokens",
				buildSwapArgs(currentQuote, false)
			);
		} catch (e) {
			if (!alive.current) return;
			// No hash came back, so the *swap* was not broadcast and Swap may
			// stay clickable. That is not the same as "nothing left this
			// machine" — see swap-card.tsx's swap() for why afterSwapAttempt
			// is set regardless: an ERC-20 approval may already be on chain.
			const explained = explain(e, liveTerms);
			if (explained.action === "policy") onPolicyRefusal?.();
			dispatch({ type: "SWAP_FAILED", explained });
			return;
		}
		if (!alive.current) return;
		dispatch({
			type: "BROADCAST",
			txHash: broadcast.txHash,
			explorer: broadcast.explorer,
			amounts: {
				amountIn: broadcast.amountIn,
				amountOut: broadcast.amountOut,
				tokenIn: broadcast.tokenIn,
				tokenOut: broadcast.tokenOut,
			},
		});
		setExplorerLinkOk(true);

		// A hash, and nothing more. The swap has not settled, so this says so —
		// every branch of the poll below sends its own update to replace it.
		tellModel(
			app,
			`Swap broadcast on ${broadcast.chain} and awaiting confirmation — tx ${broadcast.txHash}, offering ${broadcast.amountIn} ${broadcast.tokenIn} for an expected ${broadcast.amountOut} ${broadcast.tokenOut}. Nothing has settled yet; do not report this swap as done.`
		);

		let attempt = 0;
		for (;;) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			if (!alive.current) return;
			let status: TxStatusResult["status"] | undefined;
			let explorer = broadcast.explorer;
			let blockNumber = "";
			try {
				const tx = await callJson<TxStatusResult>(app, "get_tx_status", {
					hash: broadcast.txHash,
					chain: broadcast.chain,
				});
				status = tx.status;
				explorer = tx.explorer ?? explorer;
				blockNumber = tx.blockNumber;
			} catch {
				// get_tx_status throws until the transaction is mined — this is
				// indistinguishable here from a failed call, so treat every
				// throw as "not mined yet" rather than as a failure. Only a
				// resolved "confirmed" or "reverted" status below is terminal.
				status = undefined;
			}
			if (!alive.current) return;
			const decision = nextTxPoll(status, attempt);
			if (decision.action === "expired") {
				dispatch({ type: "POLL_EXPIRED" });
				tellModel(
					app,
					`Swap tx ${broadcast.txHash} on ${broadcast.chain} was broadcast, but no receipt arrived before the app stopped polling — its outcome is unknown. It may still confirm, and it may still revert. Do not state whether the ${broadcast.amountIn} ${broadcast.tokenIn} was swapped; check that hash on the explorer or with get_tx_status first.`
				);
				return;
			}
			if (decision.action === "stop") {
				if (status === "confirmed") {
					dispatch({ type: "RECEIPT", status: "confirmed", blockNumber, explorer });
					onSettled?.();
					// `amountOut` is what the handler quoted at broadcast, not
					// what the receipt settled at — within the slippage floor
					// those can differ, so it is named as the quote rather
					// than asserted as the balance.
					tellModel(
						app,
						`Swap settled on ${broadcast.chain} in block ${blockNumber} — tx ${broadcast.txHash}. The received amount is not confirmed by this widget; ${broadcast.amountOut} ${broadcast.tokenOut} was the quote at broadcast. Read the balance for the exact figure.`
					);
					return;
				}
				dispatch({ type: "RECEIPT", status: "reverted", blockNumber, explorer });
				onSettled?.();
				tellModel(
					app,
					`Swap tx ${broadcast.txHash} on ${broadcast.chain} REVERTED — no tokens changed hands. The ${broadcast.amountIn} ${broadcast.tokenIn} was not swapped and is still held; only gas was spent. Do not say the swap succeeded.`
				);
				return;
			}
			attempt = decision.attempt;
		}
	}

	async function openExplorer(url: string) {
		const r = await app.openLink({ url });
		if (r.isError && alive.current) setExplorerLinkOk(false);
	}

	/** Back to a fresh quote on the current terms — what a settled swap and a
	 *  quote that never arrived both need. Never a swap. */
	function requote() {
		dispatch({ type: "TERMS_CHANGED", terms: liveTerms });
		scheduleQuote(liveTerms);
	}

	const routed = displayQuote !== null && hasRoute(displayQuote);
	const routedQuote = displayQuote && hasRoute(displayQuote) ? displayQuote.quote : null;
	const impact = routedQuote ? formatImpact(routedQuote.priceImpact) : null;
	const impactUnknown = routed && impact === null;
	const impactClass = impact?.severity === "bad" ? "err" : (impact?.severity ?? "");

	// The one source of the button's label and of its `disabled`. Nothing
	// below computes a second one.
	const primary = primaryAction({
		state,
		connected,
		amount: liveTerms.amount,
		fromSymbol: liveTerms.from,
		short,
		quoting,
	});

	/** The only caller of swap_tokens, in either mode. */
	function onPrimary() {
		switch (primary.intent) {
			case "connect":
				onConnect?.();
				return;
			case "simulate":
				void simulate();
				return;
			case "swap":
				void swap();
				return;
			case "swap-again":
				requote();
				return;
			case "retry":
				// A simulate or swap that failed still holds its quote, so the
				// retry is the simulate again; a quote that failed holds none,
				// and the retry is the quote.
				if (currentQuote) void simulate();
				else requote();
				return;
			default:
				return;
		}
	}

	const heldOut = balances ? (balances[liveTerms.to] ?? "0") : undefined;
	// Once a swap has broadcast, the amounts it moved are the state's own
	// record (`state.amounts`), not the quote — a re-quote can never reach
	// these four kinds, but the box should still read what was actually sent.
	const settledAmounts =
		state.kind === "broadcast" ||
		state.kind === "confirmed" ||
		state.kind === "reverted" ||
		state.kind === "unknown"
			? state.amounts
			: null;
	const outputAmount = settledAmounts
		? formatAmountShort(settledAmounts.amountOut)
		: currentQuote
			? formatAmountShort(
					hasRoute(currentQuote) ? currentQuote.quote.outputAmount : currentQuote.output
				)
			: "—";

	return (
		<div class="card">
			<div class="boxes">
				<div class="box">
					<div class="box-top">
						<input
							class="box-amount"
							data-field="amount"
							inputMode="decimal"
							placeholder="0"
							aria-label={`Amount of ${liveTerms.from}`}
							value={liveTerms.amount}
							disabled={locked}
							onInput={(e) => editAmount(e.currentTarget.value)}
						/>
						<button
							class="token-btn"
							data-action="pick-from"
							onClick={() => onPickToken("from")}
						>
							{liveTerms.from} ▾
						</button>
					</div>
					<div class="box-meta">
						<span>{routedQuote && <UsdValue value={routedQuote.usdIn} />}</span>
						{connected && held !== undefined && (
							// The balance is the ceiling on this amount, so it is
							// also the control that fills it in.
							<button
								class={`bal ${short ? "over" : ""}`}
								data-action="max"
								title="Use the whole balance"
								disabled={locked}
								onClick={() => editAmount(held)}
							>
								{`${formatAmountShort(held)} ${liveTerms.from}`}
							</button>
						)}
					</div>
				</div>

				<div class="seam">
					<button
						class="flip-btn"
						data-action="flip"
						aria-label="Swap the two tokens"
						onClick={flip}
						disabled={locked}
					>
						⇅
					</button>
				</div>

				<div class="box">
					<div class="box-top">
						<span class="box-amount">{outputAmount}</span>
						<button
							class="token-btn"
							data-action="pick-to"
							onClick={() => onPickToken("to")}
						>
							{liveTerms.to} ▾
						</button>
					</div>
					<div class="box-meta">
						<span>
							{routedQuote && <UsdValue value={routedQuote.usdOut} />}
							{impact && (
								<span class={`impact ${impactClass}`}> ({impact.text})</span>
							)}
							{impactUnknown && (
								<span title="A token price was missing from the route, so price impact could not be derived.">
									{" "}
									(impact unknown)
								</span>
							)}
						</span>
						{connected && heldOut !== undefined && (
							<span>{`${formatAmountShort(heldOut)} ${liveTerms.to}`}</span>
						)}
					</div>
				</div>
			</div>

			{displayQuote && <div class="chip">⇄ {displayQuote.rate}</div>}

			<div class="detail-line">
				{/* Each part carries its own leading separator as a `::before` on
				    `.detail-sep` (nothing on the first part) — a single flex item,
				    dot glued to its text — so a wrap never strands a bare "·" at
				    the line break the way a standalone separator span could. */}
				{routedQuote && (
					<span
						class="detail-sep"
						title="Estimated from this quote. swap_tokens re-routes when it runs and derives its own on-chain floor."
					>
						Min ≈ {formatAmountShort(routedQuote.minReceived)} {routedQuote.toToken}
					</span>
				)}
				<span class="detail-sep">
					Slippage{" "}
					<input
						class="mono"
						data-field="slippage"
						aria-label="Slippage"
						value={slippageDraft}
						disabled={locked}
						onInput={(e) => editSlippage(e.currentTarget.value)}
					/>
					%
				</span>
				{/* The route is the longest part and the one the aggregator exists
				    to show, so it always takes its own line — and therefore
				    carries no leading dot, which would otherwise sit stranded at
				    the start of that line. */}
				{routedQuote && routedQuote.route.length > 0 && (
					<span class="detail-route">
						via {routedQuote.route.map(routeLabel).join(" › ")}
					</span>
				)}
			</div>
			{slippageError && <p class="error">{slippageError}</p>}

			{state.kind === "failed" && (
				<div class="error-chip">
					<span class={`pill ${state.explained.severity === "warning" ? "warn" : "err"}`}>
						{state.explained.title}
					</span>
					{state.explained.detail && <p class="muted">{state.explained.detail}</p>}
					{state.explained.raw && (
						<details>
							<summary>details</summary>
							<pre class="mono">{state.explained.raw}</pre>
						</details>
					)}
					{state.explained.action === "pick" && (
						<button class="ghost" onClick={() => onPickToken("from")}>
							Choose a different token
						</button>
					)}
					{state.afterSwapAttempt && (
						<p class="muted">
							If this swap needed an ERC-20 approval first, that approval may already
							have been sent, cost gas and left a standing allowance to the router.
							Check your wallet before retrying.
						</p>
					)}
				</div>
			)}

			{primary.intent === "swap" &&
				state.kind === "simulated" &&
				state.sim.requiresApproval && (
					<p class="muted">
						This swap needs an ERC-20 approval first — it will take two transactions and
						two wallet approvals.
					</p>
				)}

			<button
				class="primary"
				data-action="primary"
				data-intent={primary.intent}
				disabled={!primary.enabled}
				onClick={onPrimary}
			>
				{primary.label}
			</button>

			{(state.kind === "broadcast" ||
				state.kind === "confirmed" ||
				state.kind === "reverted" ||
				state.kind === "unknown") && (
				<div class="status-row">
					<span
						class={`dot ${
							state.kind === "confirmed"
								? "ok"
								: state.kind === "reverted"
									? "err"
									: "warn"
						}`}
					>
						●
					</span>
					{/* Lower case in the DOM, capitalised by the stylesheet: the
					    word is the machine's, not the card's. */}
					<span class="status-label">
						{state.kind === "broadcast"
							? "waiting for confirmation"
							: state.kind === "confirmed"
								? "confirmed"
								: state.kind === "reverted"
									? "reverted"
									: "unresolved"}
					</span>
					<span class="muted">·</span>
					<span class="mono" title={state.txHash}>
						{shortAddress(state.txHash)}
					</span>
					{state.explorer &&
						(explorerLinkOk ? (
							<button class="link-btn" onClick={() => openExplorer(state.explorer!)}>
								View on explorer
							</button>
						) : (
							<span class="muted">
								This host can't open links — the hash above is the transaction.
							</span>
						))}
				</div>
			)}

			{state.kind === "unknown" && (
				<p class="muted">
					Stopped waiting for a receipt. This is not a failure — the swap was broadcast
					and may still confirm; the hash and explorer link above are how to find out.
					Swapping is disabled from here, because a transaction that may already be in
					flight has no safe retry.
				</p>
			)}
		</div>
	);
}
