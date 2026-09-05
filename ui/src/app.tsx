import { useState } from "preact/hooks";
import type { App } from "@modelcontextprotocol/ext-apps";
import { callJson } from "./rpc.js";
import { explainError } from "./errors.js";
import { describeSession, shortAddress } from "./status.js";
import { Pairing } from "./pairing.js";
import { PolicySection } from "./policy.js";
import { SwapForm } from "./swap-form.js";
import { TokenPicker } from "./picker.js";
import type { AuthStatus, Snapshot, Terms, TokenInfo } from "./types.js";

const CHAINS = ["base", "hyperevm", "monad"] as const;
const NATIVE: Record<string, string> = { base: "ETH", hyperevm: "HYPE", monad: "MON" };

type View = { kind: "form" } | { kind: "pairing" } | { kind: "picker"; side: "from" | "to" };

function defaultTerms(chain: string): Terms {
	return { from: NATIVE[chain] ?? "ETH", to: "USDC", amount: "", slippage: 0.5 };
}

export function FibxApp({ app, snapshot }: { app: App; snapshot: Snapshot }) {
	const [chain, setChain] = useState(snapshot.chain);
	const [auth, setAuth] = useState<AuthStatus>(snapshot.auth);
	const [balances, setBalances] = useState(snapshot.balances);
	const [terms, setTerms] = useState<Terms>(snapshot.terms ?? defaultTerms(snapshot.chain));
	const [quote, setQuote] = useState(snapshot.quote);
	const [quoteError, setQuoteError] = useState(snapshot.quoteError);
	const [view, setView] = useState<View>({ kind: "form" });
	const [policyOpen, setPolicyOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function refresh() {
		try {
			const a = await callJson<AuthStatus>(app, "get_auth_status", { chain });
			setAuth(a);
			if (a.authenticated) {
				const b = await callJson<{ balances: Record<string, string> }>(app, "get_balance", {
					chain,
				});
				setBalances(b.balances);
			} else {
				setBalances(null);
			}
			void app
				.updateModelContext({
					content: [
						{
							type: "text",
							text: a.authenticated
								? `Wallet connected: ${a.walletAddress} on ${chain}`
								: "No wallet connected.",
						},
					],
				})
				.catch(() => {});
		} catch (e) {
			setError(explainError(e, {}).title);
		}
	}

	function changeChain(next: string) {
		setChain(next);
		setTerms(defaultTerms(next));
		setQuote(null);
		setQuoteError(null);
		void refresh();
	}

	function picked(side: "from" | "to", t: TokenInfo) {
		setTerms((cur) => ({ ...cur, [side]: t.symbol }));
		setQuote(null);
		setQuoteError(null);
		setView({ kind: "form" });
	}

	async function endSession() {
		try {
			await callJson(app, "logout", {});
			await refresh();
		} catch (e) {
			setError(explainError(e, {}).title);
		}
	}

	const session = describeSession(auth.sessionType ?? "walletconnect");

	return (
		<div data-fibx-app class="app">
			<header class="row app-header">
				<span class="brand">FibX</span>
				<select
					class="mono"
					value={chain}
					aria-label="Chain"
					onChange={(e) => changeChain(e.currentTarget.value)}
				>
					{CHAINS.map((c) => (
						<option value={c} key={c}>
							{c}
						</option>
					))}
				</select>
				{auth.authenticated && auth.walletAddress ? (
					<>
						<button
							class="ghost mono"
							data-action="wallet"
							title={auth.walletAddress}
							onClick={endSession}
						>
							{shortAddress(auth.walletAddress)} · end
						</button>
						<span class="muted">{session.label}</span>
						{session.approvesPerTransaction && (
							<span class="pill">approves on your phone</span>
						)}
						{session.policyIsOnlyBound && (
							<span class="pill warn">bounded by policy only</span>
						)}
					</>
				) : (
					<button data-action="wallet" onClick={() => setView({ kind: "pairing" })}>
						Connect
					</button>
				)}
			</header>

			{error && <p class="error">{error}</p>}

			{view.kind === "pairing" && (
				<Pairing
					app={app}
					onConnected={async () => {
						await refresh();
						setView({ kind: "form" });
					}}
					onCancel={() => setView({ kind: "form" })}
				/>
			)}

			{view.kind === "picker" && (
				<TokenPicker
					app={app}
					chain={chain}
					// Exclude the opposite side's token: handleGetQuote rejects
					// from === to with a message no explainError branch maps,
					// so picking from must not let the user land on terms.to
					// (and vice versa).
					exclude={view.side === "from" ? terms.to : terms.from}
					onPick={(t) => picked(view.side, t)}
					onClose={() => setView({ kind: "form" })}
				/>
			)}

			{view.kind === "form" && (
				<SwapForm
					app={app}
					chain={chain}
					terms={terms}
					quote={quote}
					quoteError={quoteError}
					balances={balances}
					connected={auth.authenticated}
					onPickToken={(side) => setView({ kind: "picker", side })}
					onPolicyRefusal={() => setPolicyOpen(true)}
					// A settled swap moved the balance the header line and the
					// shortfall guard are both drawn from.
					onSettled={refresh}
				/>
			)}

			<PolicySection
				app={app}
				initial={snapshot.policy}
				sessionKind={auth.sessionType ?? "walletconnect"}
				open={policyOpen}
			/>
		</div>
	);
}
