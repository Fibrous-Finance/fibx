import { options } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { App } from "@modelcontextprotocol/ext-apps";
import { callJson } from "./rpc.js";
import { explainError } from "./errors.js";
import { shortAddress } from "./status.js";
import {
	buildSwapArgs,
	checkSlippage,
	formatImpact,
	formatUsd,
	hasRoute,
	nextTxPoll,
	routeLabel,
	type QuoteResult,
} from "./quote.js";
import { isLocked, canSwap, initialState, transition, type Event, type State } from "./machine.js";
import type { BroadcastResult, SimulateResult, Terms, TxStatusResult } from "./types.js";

const DEBOUNCE_MS = 400;

/**
 * Preact defers a state-triggered re-render to a microtask by default, which
 * is invisible to a test that checks the DOM in the same synchronous tick as
 * the click or keystroke that caused it (no `await` in between) — and the
 * money-path guards this form exists to prove (Swap re-locking the instant an
 * amount changes, in particular) are asserted exactly that way. Rendering
 * synchronously removes the gap; it changes nothing observable about what
 * gets rendered, only when, and `useEffect` callbacks (which run on their own
 * schedule regardless of this) are unaffected.
 */
options.debounceRendering = (callback: () => void) => callback();

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
		<span
			class="muted"
			title={value === null ? "No price for this token — USD value unknown." : undefined}
		>
			{formatUsd(value)}
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
	onPolicyRefusal,
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
	onPolicyRefusal?: () => void;
}) {
	// A snapshot that arrived with a quoteError (the model asked for a quote on
	// a token that could not be resolved) starts the form already explaining
	// it — computed here, in the initializer, rather than in an effect, so it
	// is on screen at the very first render with nothing to await.
	const [state, setState] = useState<State>(() => {
		const seeded = initialState(terms, quote);
		return quoteError
			? transition(seeded, { type: "QUOTE_FAILED", message: quoteError })
			: seeded;
	});
	const dispatch = (ev: Event) => setState((s) => transition(s, ev));

	const [slippageDraft, setSlippageDraft] = useState(() => String(terms.slippage));
	const [slippageError, setSlippageError] = useState<string | null>(null);
	const [explorerLinkOk, setExplorerLinkOk] = useState(true);

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
	const locked = isLocked(state);
	const liveTerms = state.terms;

	const short =
		connected &&
		balances?.[liveTerms.from] !== undefined &&
		Number(liveTerms.amount) > Number(balances[liveTerms.from]);

	function scheduleQuote(nextTerms: Terms) {
		if (debounceRef.current) clearTimeout(debounceRef.current);
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
			dispatch({ type: "QUOTE_FAILED", message: explainError(e, {}).title });
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
			const explained = explainError(e, {});
			if (explained.action === "policy") onPolicyRefusal?.();
			dispatch({ type: "SIMULATE_FAILED", message: explained.title });
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
			const explained = explainError(e, {});
			if (explained.action === "policy") onPolicyRefusal?.();
			setState((s) =>
				s.kind === "swapping"
					? {
							kind: "failed",
							terms: s.terms,
							quote: s.quote,
							message: explained.title,
							afterSwapAttempt: true,
						}
					: s
			);
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

	const routed = currentQuote !== null && hasRoute(currentQuote);
	const impact =
		routed && currentQuote && hasRoute(currentQuote)
			? formatImpact(currentQuote.quote.priceImpact)
			: null;
	const impactUnknown = routed && impact === null;
	const impactClass = impact?.severity === "bad" ? "err" : (impact?.severity ?? "");

	const simulateDisabled = locked || short || !("quote" in state) || state.quote === null;
	const swapDisabled = locked || !canSwap(state);

	return (
		<div class="card">
			<div class="field">
				<span class="label">You Pay</span>
				<div class="row">
					<button
						class="token-btn"
						data-action="pick-from"
						onClick={() => onPickToken("from")}
					>
						{liveTerms.from} ▾
					</button>
					<input
						class="mono"
						data-field="amount"
						inputMode="decimal"
						value={liveTerms.amount}
						disabled={locked}
						onInput={(e) => editAmount(e.currentTarget.value)}
					/>
				</div>
				{connected && <span class="muted">bal {balances?.[liveTerms.from] ?? "—"}</span>}
			</div>

			{short &&
				(() => {
					const explained = explainError(new Error("insufficient"), {
						symbol: liveTerms.from,
						amount: liveTerms.amount,
						balance: balances?.[liveTerms.from],
					});
					return (
						<div>
							<p class="error">{explained.title}</p>
							{explained.detail && <p class="muted">{explained.detail}</p>}
						</div>
					);
				})()}

			<div class="row">
				<button class="flip ghost" data-action="flip" onClick={flip} disabled={locked}>
					⇅
				</button>
			</div>

			<div class="field">
				<span class="label">You Receive</span>
				<div class="row">
					<button
						class="token-btn"
						data-action="pick-to"
						onClick={() => onPickToken("to")}
					>
						{liveTerms.to} ▾
					</button>
					<span class="amount mono">
						{currentQuote
							? hasRoute(currentQuote)
								? currentQuote.quote.outputAmount
								: currentQuote.output
							: "—"}
					</span>
					{routed && currentQuote && hasRoute(currentQuote) && (
						<UsdValue value={currentQuote.quote.usdOut} />
					)}
				</div>
			</div>

			{currentQuote && (
				<div class="price-info">
					<div class="row">
						<span class="mono muted">{currentQuote.rate}</span>
						{impact && <span class={`pill ${impactClass}`}>{impact.text}</span>}
						{impactUnknown && (
							<span
								class="muted"
								title="A token price was missing from the route, so price impact could not be derived."
							>
								price impact unknown
							</span>
						)}
					</div>

					{routed && hasRoute(currentQuote) && currentQuote.quote.route.length > 0 && (
						<div class="row">
							{currentQuote.quote.route.map((hop, i) => (
								<span class="pill" key={`${hop.protocol}-${hop.pool}-${i}`}>
									{routeLabel(hop)}
								</span>
							))}
						</div>
					)}

					{routed && hasRoute(currentQuote) && (
						<div class="row">
							<span
								class="mono muted"
								title="Estimated from this quote. swap_tokens re-routes when it runs and derives its own on-chain floor."
							>
								≈ {currentQuote.quote.minReceived} {currentQuote.quote.toToken}{" "}
								(est.)
							</span>
						</div>
					)}
				</div>
			)}

			<div class="field">
				<span class="label">Slippage</span>
				<input
					class="mono"
					data-field="slippage"
					value={slippageDraft}
					disabled={locked}
					onInput={(e) => editSlippage(e.currentTarget.value)}
				/>
			</div>
			{slippageError && <p class="error">{slippageError}</p>}

			{state.kind === "failed" &&
				(() => {
					const explained = explainError(new Error(state.message), {
						symbol: state.terms.from,
					});
					return (
						<div>
							<p class="error">{explained.title}</p>
							{explained.detail && <p class="muted">{explained.detail}</p>}
							{explained.raw && (
								<details>
									<summary>details</summary>
									<pre class="mono">{explained.raw}</pre>
								</details>
							)}
							{explained.action === "pick" && (
								<button class="ghost" onClick={() => onPickToken("from")}>
									Choose a different token
								</button>
							)}
							{state.afterSwapAttempt && (
								<p class="muted">
									If this swap needed an ERC-20 approval first, that approval may
									already have been sent, cost gas and left a standing allowance
									to the router. Check your wallet before retrying.
								</p>
							)}
						</div>
					);
				})()}

			{state.kind === "simulated" && state.sim.requiresApproval && (
				<p class="muted">
					This swap needs an ERC-20 approval first — it will take two transactions and two
					wallet approvals.
				</p>
			)}

			<div class="row">
				<button
					class="ghost"
					data-action="simulate"
					disabled={simulateDisabled}
					onClick={simulate}
				>
					{state.kind === "simulating" ? "Simulating…" : "Simulate"}
				</button>
				<button data-action="swap" disabled={swapDisabled} onClick={swap}>
					{state.kind === "swapping" ? "Swapping…" : "Swap"}
				</button>
			</div>

			{(state.kind === "broadcast" ||
				state.kind === "confirmed" ||
				state.kind === "reverted" ||
				state.kind === "unknown") && (
				<div class="row">
					<span
						class={`pill ${
							state.kind === "confirmed"
								? "ok"
								: state.kind === "reverted"
									? "err"
									: "warn"
						}`}
					>
						{state.kind === "broadcast"
							? "waiting for confirmation"
							: state.kind === "confirmed"
								? "confirmed"
								: state.kind === "reverted"
									? "reverted"
									: "unresolved"}
					</span>
					<span class="mono" title={state.txHash}>
						{shortAddress(state.txHash)}
					</span>
					{state.explorer && explorerLinkOk && (
						<button class="ghost" onClick={() => openExplorer(state.explorer!)}>
							View on explorer
						</button>
					)}
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
