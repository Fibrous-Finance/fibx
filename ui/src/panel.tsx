import { useEffect, useRef, useState } from "preact/hooks";
import type { App } from "@modelcontextprotocol/ext-apps";
import { callJson } from "./rpc.js";
import { nextPoll, type ConnectStatus } from "./status.js";

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
	// Once the panel has fetched auth for itself, a late host push (a stale
	// get_auth_status result arriving after the panel already refetched, e.g.
	// right after onConnected) must not overwrite what the panel knows. Only
	// the very first render is seeded from the host's push.
	const hasFetchedOwnAuth = useRef(false);

	useEffect(() => {
		if (!hasFetchedOwnAuth.current) setAuth(initial);
	}, [initial]);

	async function refreshAuth() {
		try {
			const result = await callJson<AuthStatus>(app, "get_auth_status", {});
			hasFetchedOwnAuth.current = true;
			setAuth(result);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
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
			<h1>FibX Wallet</h1>
			{error && <p class="error">{error}</p>}
			{auth.authenticated ? (
				<Connected app={app} auth={auth} onChange={refreshAuth} />
			) : (
				<Disconnected app={app} onConnected={refreshAuth} />
			)}
		</div>
	);
}

/** Placeholder until Task 7; keeps Task 5 compiling on its own. */
function Connected({ auth }: { app: App; auth: AuthStatus; onChange: () => Promise<void> }) {
	return (
		<div class="card">
			<div class="row">
				<span class="pill ok">connected</span>
				<span class="mono">{auth.walletAddress}</span>
			</div>
		</div>
	);
}

export function Disconnected({ app, onConnected }: { app: App; onConnected: () => Promise<void> }) {
	const [phase, setPhase] = useState<ConnectPhase>({ kind: "idle" });
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
			<div class="row">
				<button class="ghost" onClick={() => copyUri(pairing.uri)}>
					Copy link
				</button>
				{phase.kind === "expired" && <button onClick={connect}>Try again</button>}
			</div>
		</div>
	);
}
