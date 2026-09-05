import { useEffect, useRef, useState } from "preact/hooks";
import type { App } from "@modelcontextprotocol/ext-apps";
import { explainError, type Explained } from "./errors.js";
import { callJson } from "./rpc.js";
import { nextPoll, type ConnectStatus } from "./status.js";
import type { Pairing as PairingInfo } from "./types.js";

type ConnectPhase =
	| { kind: "idle" }
	| { kind: "opening" }
	| { kind: "waiting"; pairing: PairingInfo }
	| { kind: "expired"; pairing: PairingInfo }
	| { kind: "failed"; explained: Explained };

/**
 * Copy to the clipboard with a fallback chain, not a single call: the modern
 * `navigator.clipboard` API is what a host declares support for, but a
 * sandboxed host can still refuse it at call time. `execCommand("copy")` on a
 * hidden, selected textarea is the legacy path, and it usually survives a
 * sandbox that blocks the modern one — which is the whole reason it runs
 * second rather than being skipped. Only when both fail is there nothing left
 * to offer the caller but "unavailable".
 */
export async function copyText(text: string): Promise<"clipboard" | "execCommand" | "unavailable"> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return "clipboard";
		}
	} catch {
		// fall through to the legacy path
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "");
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		ta.remove();
		if (ok) return "execCommand";
	} catch {
		// fall through
	}
	return "unavailable";
}

export function Pairing({
	app,
	onConnected,
	onCancel,
}: {
	app: App;
	onConnected: () => Promise<void>;
	onCancel: () => void;
}) {
	const [phase, setPhase] = useState<ConnectPhase>({ kind: "idle" });
	const [copyState, setCopyState] = useState<"ready" | "copied" | "unavailable">("ready");
	const [walletLinkState, setWalletLinkState] = useState<"ready" | "refused">("ready");
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
		let pairing: PairingInfo;
		try {
			pairing = await callJson<PairingInfo>(app, "connect_wallet", {});
		} catch (e) {
			if (!alive.current) return;
			setPhase({ kind: "failed", explained: explainError(e, {}) });
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
				setPhase({ kind: "failed", explained: explainError(e, {}) });
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
						explained: explainError(
							new Error(result.error ?? `pairing ${result.status}`),
							{}
						),
					});
				}
				return;
			}
			attempt = decision.attempt;
		}
	}

	const backButton = (
		<button class="ghost wide" data-action="back" onClick={onCancel}>
			Back
		</button>
	);

	if (phase.kind === "idle" || phase.kind === "opening" || phase.kind === "failed") {
		return (
			<div class="card">
				<p class="muted">No wallet is connected. Pair your own wallet to sign from it.</p>
				{phase.kind === "failed" && (
					<div class="error-chip">
						<span
							class={`pill ${phase.explained.severity === "warning" ? "warn" : "err"}`}
						>
							{phase.explained.title}
						</span>
						{phase.explained.detail && <p class="muted">{phase.explained.detail}</p>}
						{phase.explained.raw && (
							<details>
								<summary>details</summary>
								<pre class="mono">{phase.explained.raw}</pre>
							</details>
						)}
					</div>
				)}
				<button
					class="primary"
					data-action="connect"
					onClick={connect}
					disabled={phase.kind === "opening"}
				>
					{phase.kind === "opening" ? "Opening a pairing…" : "Connect a wallet"}
				</button>
				{backButton}
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
			{/* The same box the amounts sit in, so the pairing view reads as
			    part of the card rather than as a different screen. */}
			<div class="box">
				<img class="qr" src={pairing.qrDataUri} alt="WalletConnect pairing QR" />
				<textarea
					class="uri"
					readOnly
					value={pairing.uri}
					onFocus={(e) => e.currentTarget.select()}
				/>
			</div>
			<div class="row">
				{walletLinkState === "ready" ? (
					<button
						class="ghost wide"
						data-action="open-wallet"
						onClick={async () => {
							const r = await app.openLink({ url: pairing.uri });
							// A refusal is a result, not an exception. If the host will
							// not dispatch a wc: URI, retire the button — the QR and
							// the copyable URI both still work.
							if (r.isError && alive.current) setWalletLinkState("refused");
						}}
					>
						Open in your wallet
					</button>
				) : (
					<span class="muted">
						This host can't open wallet links — scan the QR or copy the link.
					</span>
				)}
			</div>
			<div class="row">
				{copyState !== "unavailable" ? (
					<button
						class="ghost wide"
						data-action="copy"
						onClick={async () => {
							const how = await copyText(pairing.uri);
							if (!alive.current) return;
							if (how === "unavailable") setCopyState("unavailable");
							else {
								setCopyState("copied");
								setTimeout(() => alive.current && setCopyState("ready"), 1500);
							}
						}}
					>
						{copyState === "copied" ? "Copied" : "Copy link"}
					</button>
				) : (
					<span class="muted">
						Clipboard unavailable here — select the link above and copy it.
					</span>
				)}
				{phase.kind === "expired" && (
					<button class="primary" onClick={connect}>
						Try again
					</button>
				)}
				{backButton}
			</div>
		</div>
	);
}
