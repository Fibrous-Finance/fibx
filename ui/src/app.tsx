import { useState } from "preact/hooks";
import type { App } from "@modelcontextprotocol/ext-apps";
import { callJson } from "./rpc.js";
import { explainError } from "./errors.js";
import { shortAddress } from "./status.js";
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
					<button
						class="ghost mono"
						data-action="wallet"
						title={auth.walletAddress}
						onClick={endSession}
					>
						{shortAddress(auth.walletAddress)} · end
					</button>
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
					// The token already sitting on the side being changed —
					// re-picking it would be a no-op. (Not the opposite side:
					// a picker with only one token listed, e.g. in a test,
					// must still be able to select it.)
					exclude={view.side === "from" ? terms.from : terms.to}
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
