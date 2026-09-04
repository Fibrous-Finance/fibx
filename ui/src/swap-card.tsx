import { useEffect, useRef, useState } from "preact/hooks";
import type { App } from "@modelcontextprotocol/ext-apps";
import { callJson } from "./rpc.js";
import { shortAddress } from "./status.js";
import {
	buildSwapArgs,
	formatImpact,
	hasRoute,
	nextTxPoll,
	routeLabel,
	type QuoteResult,
} from "./quote.js";

type SimulateResult = {
	success: true;
	mode: string;
	amountIn: string;
	amountOut?: string;
	tokenIn: string;
	tokenOut: string;
	chain: string;
	requiresApproval?: boolean;
	estimatedGas?: string;
};

type BroadcastResult = {
	txHash: string;
	amountIn: string;
	amountOut: string;
	tokenIn: string;
	tokenOut: string;
	chain: string;
	explorer?: string;
};

type TxStatusResult = {
	hash: string;
	status: "confirmed" | "reverted";
	blockNumber: string;
	explorer?: string;
};

type Phase =
	| { kind: "idle" }
	| { kind: "simulating" }
	| { kind: "simulated"; result: SimulateResult }
	| { kind: "swapping" }
	| { kind: "broadcast"; txHash: string; explorer?: string }
	| { kind: "confirmed"; txHash: string; explorer?: string; blockNumber: string }
	| { kind: "reverted"; txHash: string; explorer?: string }
	| { kind: "failed"; message: string };

function draftFor(result: QuoteResult | null): string {
	return result && hasRoute(result) ? String(result.quote.slippage) : "";
}

export function SwapCard({ app, initial }: { app: App; initial: QuoteResult | null }) {
	// initial can still be null here: a host that populates toolInfo before
	// dispatching the toolresult notification flips `surface` to "swap-card"
	// in main.tsx before any payload has arrived (see the "waiting for the
	// host…" branch below), so every hook below has to tolerate a null quote.
	const [current, setCurrent] = useState<QuoteResult | null>(initial);
	const seeded = useRef(initial !== null);
	useEffect(() => {
		if (seeded.current || !initial) return;
		seeded.current = true;
		setCurrent(initial);
	}, [initial]);

	const [slippageDraft, setSlippageDraft] = useState(() => draftFor(initial));
	useEffect(() => {
		setSlippageDraft(draftFor(current));
	}, [current]);

	const [requoting, setRequoting] = useState(false);
	const [requoteError, setRequoteError] = useState<string | null>(null);
	const [phase, setPhase] = useState<Phase>({ kind: "idle" });
	const [explorerLinkOk, setExplorerLinkOk] = useState(true);

	// The same house pattern Disconnected (panel.tsx) uses: set false on
	// unmount, checked after every await before any state set. A slippage
	// re-quote and the swap/poll loop both outlive a card the host can tear
	// down at any point.
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	const busy =
		requoting ||
		phase.kind === "simulating" ||
		phase.kind === "swapping" ||
		phase.kind === "broadcast";

	async function requote(rawSlippage: string) {
		if (!current || !hasRoute(current)) return;
		const slippage = Number(rawSlippage);
		if (!Number.isFinite(slippage) || slippage <= 0) {
			setRequoteError("Slippage must be a positive number.");
			return;
		}
		setRequoting(true);
		setRequoteError(null);
		try {
			const result = await callJson<QuoteResult>(app, "get_quote", {
				amount: current.quote.inputAmount,
				from_token: current.quote.fromToken,
				to_token: current.quote.toToken,
				chain: current.quote.chain,
				slippage,
			});
			if (!alive.current) return;
			setCurrent(result);
			// A new quote invalidates whatever the old simulate/swap flow found.
			setPhase({ kind: "idle" });
		} catch (e) {
			if (!alive.current) return;
			setRequoteError(e instanceof Error ? e.message : String(e));
		} finally {
			if (alive.current) setRequoting(false);
		}
	}

	async function simulate() {
		if (!current) return;
		setPhase({ kind: "simulating" });
		try {
			const result = await callJson<SimulateResult>(
				app,
				"swap_tokens",
				buildSwapArgs(current, true)
			);
			if (!alive.current) return;
			setPhase({ kind: "simulated", result });
		} catch (e) {
			if (!alive.current) return;
			setPhase({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
		}
	}

	async function swap() {
		if (!current) return;
		setPhase({ kind: "swapping" });
		let broadcast: BroadcastResult;
		try {
			broadcast = await callJson<BroadcastResult>(
				app,
				"swap_tokens",
				buildSwapArgs(current, false)
			);
		} catch (e) {
			if (!alive.current) return;
			setPhase({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
			return;
		}
		if (!alive.current) return;
		setPhase({ kind: "broadcast", txHash: broadcast.txHash, explorer: broadcast.explorer });
		setExplorerLinkOk(true);

		// MCP Apps does not push UI state to the model on its own — without
		// this, the model's next reply can contradict what the card is
		// showing, which is exactly what happened during the wallet panel's
		// manual verification.
		void app
			.updateModelContext({
				content: [
					{
						type: "text",
						text: `Swapped ${broadcast.amountIn} ${broadcast.tokenIn} for ${broadcast.amountOut} ${broadcast.tokenOut} on ${broadcast.chain} — tx ${broadcast.txHash}`,
					},
				],
			})
			.catch(() => {});

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
				setPhase({
					kind: "failed",
					message:
						"Gave up waiting for confirmation. The transaction may still land — check the explorer.",
				});
				return;
			}
			if (decision.action === "stop") {
				setPhase(
					status === "confirmed"
						? { kind: "confirmed", txHash: broadcast.txHash, explorer, blockNumber }
						: { kind: "reverted", txHash: broadcast.txHash, explorer }
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

	if (!current) {
		return (
			<div data-fibx-swap-card class="card">
				<h1>Swap</h1>
				<p class="muted">waiting for the host…</p>
			</div>
		);
	}

	const routed = hasRoute(current);
	const impact = routed ? formatImpact(current.quote.priceImpact) : null;
	const impactClass = impact?.severity === "bad" ? "err" : (impact?.severity ?? "");

	return (
		<div data-fibx-swap-card class="card">
			<h1>Swap</h1>

			<div class="amount-row">
				<span class="label">You Pay</span>
				<span class="amount mono">
					{routed
						? `${current.quote.inputAmount} ${current.quote.fromToken}`
						: current.input}
				</span>
				{routed && <span class="muted">${current.quote.usdIn.toFixed(2)}</span>}
			</div>

			<div class="amount-row">
				<span class="label">You Receive</span>
				<span class="amount mono">
					{routed
						? `${current.quote.outputAmount} ${current.quote.toToken}`
						: current.output}
				</span>
				{routed && <span class="muted">${current.quote.usdOut.toFixed(2)}</span>}
			</div>

			<div class="row">
				<span class="mono muted">{current.rate}</span>
				{impact && <span class={`pill ${impactClass}`}>{impact.text}</span>}
			</div>

			{/* A 1:1 wrap/unwrap has no route, no hops and no price impact — the
			    section below is omitted rather than shown empty or fake-zero. */}
			{routed && current.quote.route.length > 0 && (
				<div>
					<span class="label">Route</span>
					<div class="row">
						{current.quote.route.map((hop, i) => (
							<span class="pill" key={`${hop.protocol}-${hop.pool}-${i}`}>
								{routeLabel(hop)}
							</span>
						))}
					</div>
				</div>
			)}

			{routed && (
				<form
					class="row"
					onSubmit={(e) => {
						e.preventDefault();
						void requote(slippageDraft);
					}}
				>
					<span class="label">Min received</span>
					<span class="mono">
						{current.quote.minReceived} {current.quote.toToken}
					</span>
					<input
						class="mono"
						value={slippageDraft}
						onInput={(e) => setSlippageDraft(e.currentTarget.value)}
						disabled={busy}
						aria-label="Slippage percent"
					/>
					<button
						type="submit"
						class="ghost"
						disabled={busy || slippageDraft === String(current.quote.slippage)}
					>
						{requoting ? "Updating…" : "Update"}
					</button>
				</form>
			)}
			{requoteError && <p class="error">{requoteError}</p>}

			<div class="row">
				<button class="ghost" onClick={simulate} disabled={busy}>
					{phase.kind === "simulating" ? "Simulating…" : "Simulate"}
				</button>
				<button onClick={swap} disabled={busy}>
					{phase.kind === "swapping" ? "Swapping…" : "Swap"}
				</button>
			</div>

			{phase.kind === "simulated" &&
				(phase.result.requiresApproval ? (
					<p class="muted">
						This swap needs an ERC-20 approval first — it will take two transactions and
						two wallet approvals.
					</p>
				) : (
					<p class="muted">
						{/* A wrap/unwrap simulate response never carries amountOut — the
						    handler treats it as always equal to amountIn, being 1:1. */}
						{phase.result.mode}: {phase.result.amountIn} {phase.result.tokenIn} →{" "}
						{phase.result.amountOut ?? phase.result.amountIn} {phase.result.tokenOut}
						{phase.result.estimatedGas && ` · ~${phase.result.estimatedGas} gas`}
					</p>
				))}

			{(phase.kind === "broadcast" ||
				phase.kind === "confirmed" ||
				phase.kind === "reverted") && (
				<div class="row">
					<span
						class={`pill ${
							phase.kind === "confirmed"
								? "ok"
								: phase.kind === "reverted"
									? "err"
									: "warn"
						}`}
					>
						{phase.kind === "broadcast"
							? "waiting for confirmation"
							: phase.kind === "confirmed"
								? "confirmed"
								: "reverted"}
					</span>
					<span class="mono" title={phase.txHash}>
						{shortAddress(phase.txHash)}
					</span>
					{phase.explorer && explorerLinkOk && (
						<button class="ghost" onClick={() => openExplorer(phase.explorer!)}>
							View on explorer
						</button>
					)}
				</div>
			)}

			{phase.kind === "failed" && <p class="error">{phase.message}</p>}
		</div>
	);
}
