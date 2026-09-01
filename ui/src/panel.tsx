import { useEffect, useRef, useState } from "preact/hooks";
import type { App } from "@modelcontextprotocol/ext-apps";
import { callJson } from "./rpc.js";
import {
	describeSession,
	nextPoll,
	policyRows,
	shortAddress,
	type ConnectStatus,
	type Policy,
	type SessionKind,
} from "./status.js";
import { walletLinks } from "./wallets.js";

export type AuthStatus = {
	authenticated: boolean;
	walletAddress: string | null;
	sessionType: "walletconnect" | "privy" | "private-key" | null;
	chain: string;
	requiresApprovalPerTransaction: boolean;
	fibrousStatus: string;
};

type Pairing = { uri: string; qrDataUri: string; pairingId: string };
type ConnectPhase =
	| { kind: "idle" }
	| { kind: "opening" }
	| { kind: "waiting"; pairing: Pairing }
	| { kind: "expired"; pairing: Pairing }
	| { kind: "failed"; message: string };

export function Panel({ app, initial }: { app: App; initial: AuthStatus | null }) {
	const [auth, setAuth] = useState<AuthStatus | null>(initial);
	const [error, setError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	// Once the panel has fetched auth for itself, a late host push (a stale
	// get_auth_status result arriving after the panel already refetched, e.g.
	// right after onConnected) must not overwrite what the panel knows. Only
	// the very first render is seeded from the host's push.
	const hasFetchedOwnAuth = useRef(false);

	useEffect(() => {
		if (!hasFetchedOwnAuth.current) setAuth(initial);
	}, [initial]);

	// An error from an earlier failed refetch must not sit above a fresh,
	// unrelated message once the view has swapped (e.g. Disconnected just
	// connected, or Connected's own state changed).
	useEffect(() => {
		setError(null);
	}, [auth?.authenticated, auth?.walletAddress]);

	async function refreshAuth() {
		setRefreshing(true);
		try {
			const result = await callJson<AuthStatus>(app, "get_auth_status", {});
			hasFetchedOwnAuth.current = true;
			setAuth(result);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setRefreshing(false);
		}
	}

	if (!auth) {
		return (
			<div data-fibx-panel>
				<h1>FibX Wallet</h1>
				<p class="muted">waiting for the host…</p>
			</div>
		);
	}

	return (
		<div data-fibx-panel>
			<div class="row">
				<h1>FibX Wallet</h1>
				<button class="ghost" onClick={refreshAuth} disabled={refreshing}>
					{refreshing ? "Refreshing…" : "Refresh"}
				</button>
			</div>
			{error && <p class="error">{error}</p>}
			{auth.authenticated ? (
				<Connected app={app} auth={auth} onChange={refreshAuth} />
			) : (
				<Disconnected app={app} onConnected={refreshAuth} />
			)}
		</div>
	);
}

type Balances = { wallet: string; chain: string; balances: Record<string, string> };

function Connected({
	app,
	auth,
	onChange,
}: {
	app: App;
	auth: AuthStatus;
	onChange: () => Promise<void>;
}) {
	const [balances, setBalances] = useState<Balances | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const session = describeSession(auth.sessionType ?? "walletconnect");

	useEffect(() => {
		let cancelled = false;
		callJson<Balances>(app, "get_balance", { chain: auth.chain })
			.then((b) => {
				if (cancelled) return;
				setBalances(b);
				setError(null);
			})
			.catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
		return () => {
			cancelled = true;
		};
	}, [auth.walletAddress, auth.chain]);

	async function endSession() {
		setBusy("Ending the session…");
		try {
			await callJson(app, "logout", {});
			await onChange();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	}

	return (
		<>
			<div class="card">
				<div class="row">
					<span class="pill ok">connected</span>
					<span class="pill">{auth.chain}</span>
					{session.approvesPerTransaction && (
						<span class="pill">approves on your phone</span>
					)}
					{session.policyIsOnlyBound && (
						<span class="pill warn">bounded by policy only</span>
					)}
				</div>
				<div class="mono" title={auth.walletAddress ?? ""}>
					{auth.walletAddress ? shortAddress(auth.walletAddress) : "—"}
				</div>
				<p class="muted">{session.label}</p>
				{error && <p class="error">{error}</p>}
				<div class="row">
					<button class="ghost" onClick={endSession} disabled={busy !== null}>
						{busy ?? "End session"}
					</button>
				</div>
			</div>

			<div class="card">
				<h1>Balances</h1>
				{balances ? (
					<table>
						<thead>
							<tr>
								<th>Asset</th>
								<th>Amount</th>
							</tr>
						</thead>
						<tbody>
							{Object.entries(balances.balances).map(([symbol, amount]) => (
								<tr key={symbol}>
									<td>{symbol}</td>
									<td class="mono">{amount}</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<p class="muted">loading…</p>
				)}
			</div>

			<PolicyCard app={app} sessionKind={auth.sessionType ?? "walletconnect"} />
		</>
	);
}

type PolicyState =
	| { state: "active"; rules: Policy; path: string }
	| { state: "absent"; path: string; message: string }
	| { state: "unreadable"; path: string; message: string };

function PolicyCard({ app, sessionKind }: { app: App; sessionKind: SessionKind }) {
	const [policy, setPolicy] = useState<PolicyState | null>(null);
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [draft, setDraft] = useState<{ rule: string; value: string }>({
		rule: "base.maxValue",
		value: "",
	});
	// Guards the whole-policy delete: sandboxed iframes run without
	// `allow-modals`, so `window.confirm()` returns false silently and the
	// button would never do anything, with nothing to explain why. This state
	// swaps the button row for an inline "are you sure" instead.
	const [confirmingWipe, setConfirmingWipe] = useState(false);

	async function load() {
		try {
			setPolicy(await callJson<PolicyState>(app, "get_policy", {}));
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	useEffect(() => {
		void load();
	}, []);

	// Every write goes through the host's approval prompt. While that prompt
	// is up the call has not returned, so say so — a frozen button reads as a
	// bug. And never trust our own write: reload from get_policy afterwards.
	async function write(label: string, name: string, args: Record<string, unknown>) {
		setPending(label);
		setError(null);
		try {
			await callJson(app, name, args);
			await load();
		} catch (e) {
			// Validation failures arrive with the right message and an
			// uninformative code — render the message, never branch on the code.
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setPending(null);
		}
	}

	if (!policy)
		return (
			<div class="card">
				<h1>Signing policy</h1>
				<p class="muted">loading…</p>
			</div>
		);

	return (
		<div class="card">
			<div class="row">
				<h1 style="margin:0">Signing policy</h1>
				{policy.state === "active" && <span class="pill ok">active</span>}
				{policy.state === "absent" && (
					<span class={`pill ${sessionKind === "private-key" ? "warn" : ""}`}>
						none set
					</span>
				)}
				{policy.state === "unreadable" && <span class="pill err">unreadable</span>}
			</div>

			{policy.state === "unreadable" && (
				<p class="error">
					{policy.message} <span class="mono">{policy.path}</span>
				</p>
			)}
			{policy.state === "absent" && (
				<p class="muted">
					{policy.message}
					{sessionKind === "private-key" &&
						" On an imported key this is the only bound there is."}
				</p>
			)}

			{policy.state === "active" && (
				<table>
					<tbody>
						{policyRows(policy.rules).map((row) => (
							<tr key={row.rule}>
								<td class="mono">{row.rule}</td>
								<td class="mono">{row.value}</td>
								<td>
									<button
										class="ghost"
										disabled={pending !== null}
										onClick={() =>
											write(`Removing ${row.rule}…`, "clear_policy_rule", {
												rule: row.rule,
											})
										}
									>
										Remove
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			{policy.state !== "unreadable" && (
				<form
					class="row"
					onSubmit={(e) => {
						e.preventDefault();
						if (!draft.value.trim()) return;
						void write(`Setting ${draft.rule}…`, "set_policy_rule", {
							rule: draft.rule,
							value: draft.value.trim(),
						});
					}}
				>
					<input
						class="mono"
						value={draft.rule}
						onInput={(e) => setDraft({ ...draft, rule: e.currentTarget.value })}
						placeholder="base.maxValue"
						aria-label="Rule"
					/>
					<input
						class="mono"
						value={draft.value}
						onInput={(e) => setDraft({ ...draft, value: e.currentTarget.value })}
						placeholder="0.05"
						aria-label="Value"
					/>
					<button type="submit" disabled={pending !== null}>
						{pending ?? "Set"}
					</button>
				</form>
			)}

			<p class="muted">
				maxValue caps the native value of one transaction. It does not bound token amounts —
				an ERC-20 transfer carries value 0 — so use allowedDestinations to bound where
				tokens may go.
			</p>

			{policy.state !== "absent" && (
				<div class="row">
					{confirmingWipe ? (
						<>
							<span class="muted">
								Remove the whole policy? Nothing will limit signing afterwards.
							</span>
							<button
								class="ghost"
								disabled={pending !== null}
								onClick={() => {
									setConfirmingWipe(false);
									void write("Removing the policy…", "clear_policy_rule", {
										all: true,
									});
								}}
							>
								Remove
							</button>
							<button
								class="ghost"
								disabled={pending !== null}
								onClick={() => setConfirmingWipe(false)}
							>
								Keep
							</button>
						</>
					) : (
						<button
							class="ghost"
							disabled={pending !== null}
							onClick={() => setConfirmingWipe(true)}
						>
							Remove whole policy
						</button>
					)}
				</div>
			)}
			{error && <p class="error">{error}</p>}
		</div>
	);
}

export function Disconnected({ app, onConnected }: { app: App; onConnected: () => Promise<void> }) {
	const [phase, setPhase] = useState<ConnectPhase>({ kind: "idle" });
	const [linksAllowed, setLinksAllowed] = useState(true);
	// The poll loop below can outlive this component — the panel switches to
	// Connected, or the host tears the iframe down — and without this flag it
	// keeps calling get_connect_status and setting state on an unmounted
	// component for up to MAX_POLL_ATTEMPTS. Checked after every await, before
	// the next tool call or state set.
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	async function connect() {
		setPhase({ kind: "opening" });
		let pairing: Pairing;
		try {
			pairing = await callJson<Pairing>(app, "connect_wallet", {});
		} catch (e) {
			if (!alive.current) return;
			setPhase({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
			return;
		}
		if (!alive.current) return;
		setPhase({ kind: "waiting", pairing });

		// connect_wallet returns as soon as the pairing exists; approval happens
		// on someone's phone, so the answer arrives by polling, not by that call.
		let attempt = 0;
		for (;;) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			if (!alive.current) return;
			let result: ConnectStatus;
			try {
				result = await callJson<ConnectStatus>(app, "get_connect_status", {
					pairingId: pairing.pairingId,
				});
			} catch (e) {
				if (!alive.current) return;
				setPhase({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
				return;
			}
			if (!alive.current) return;
			const decision = nextPoll(result, attempt);
			if (decision.action === "expired") {
				setPhase({ kind: "expired", pairing });
				return;
			}
			if (decision.action === "stop") {
				if (result.status === "connected") {
					await onConnected();
					if (!alive.current) return;
					setPhase({ kind: "idle" });
				} else {
					setPhase({
						kind: "failed",
						message: result.error ?? `pairing ${result.status}`,
					});
				}
				return;
			}
			attempt = decision.attempt;
		}
	}

	async function copyUri(uri: string) {
		try {
			await navigator.clipboard.writeText(uri);
		} catch {
			// The sandbox may refuse the clipboard; the textarea is selectable
			// on purpose so the URI is never unreachable.
		}
	}

	if (phase.kind === "idle" || phase.kind === "opening" || phase.kind === "failed") {
		return (
			<div class="card">
				<p class="muted">No wallet is connected. Pair your own wallet to sign from it.</p>
				{phase.kind === "failed" && <p class="error">{phase.message}</p>}
				<button onClick={connect} disabled={phase.kind === "opening"}>
					{phase.kind === "opening" ? "Opening a pairing…" : "Connect a wallet"}
				</button>
			</div>
		);
	}

	const { pairing } = phase;
	return (
		<div class="card">
			<div class="row">
				<span class={`pill ${phase.kind === "expired" ? "warn" : ""}`}>
					{phase.kind === "expired" ? "expired" : "waiting for the wallet"}
				</span>
			</div>
			<img class="qr" src={pairing.qrDataUri} alt="WalletConnect pairing QR" />
			<textarea
				class="uri"
				readOnly
				value={pairing.uri}
				onFocus={(e) => e.currentTarget.select()}
			/>
			{linksAllowed && (
				<div class="row">
					{walletLinks(pairing.uri).map((l) => (
						<button
							class="ghost"
							onClick={async () => {
								const r = await app.openLink({ url: l.url });
								// A refusal is a result, not an exception. Once the host
								// says no, every shortcut would say no — drop them all
								// and leave the copyable URI, which always works.
								if (r.isError) {
									if (!alive.current) return;
									setLinksAllowed(false);
								}
							}}
						>
							Open in {l.name}
						</button>
					))}
				</div>
			)}
			<div class="row">
				<button class="ghost" onClick={() => copyUri(pairing.uri)}>
					Copy link
				</button>
				{phase.kind === "expired" && <button onClick={connect}>Try again</button>}
			</div>
		</div>
	);
}
