import { useEffect, useState } from "preact/hooks";
import type { App } from "@modelcontextprotocol/ext-apps";
import { callJson } from "./rpc.js";
import { explainError, type Explained } from "./errors.js";
import { policyRows } from "./status.js";
import type { PolicyState, SessionKind } from "./types.js";

/** The header's one-line summary — also used by the shell to decide whether a
 * `POLICY_BLOCKED` refusal needs to open this section. */
export function policySummary(p: PolicyState): string {
	switch (p.state) {
		case "active":
			return "active";
		case "absent":
			return "none set";
		case "unreadable":
			return "unreadable";
	}
}

export function PolicySection({
	app,
	initial,
	sessionKind,
	openNonce,
}: {
	app: App;
	initial: PolicyState;
	sessionKind: SessionKind;
	/** A count of refusals, not a flag. A boolean latches: once the shell had
	 *  set it true, a second POLICY_BLOCKED after the user collapsed this
	 *  section re-rendered the same `true` and the effect below never ran
	 *  again. Every refusal bumps this, so every refusal re-opens. */
	openNonce?: number;
}) {
	const [isOpen, setIsOpen] = useState((openNonce ?? 0) > 0);
	useEffect(() => {
		if (openNonce) setIsOpen(true);
	}, [openNonce]);
	const [policy, setPolicy] = useState<PolicyState>(initial);
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<Explained | null>(null);
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
			setError(explainError(e, {}));
		}
	}

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
			setError(explainError(e, {}));
		} finally {
			setPending(null);
		}
	}

	return (
		<div class="card">
			{/* One row, closed: the name, the state, and the arrow that opens
			    it. Everything else in this section is behind that click. */}
			<div class="policy-row">
				<button class="bare" data-action="toggle-policy" onClick={() => setIsOpen(!isOpen)}>
					Signing policy
				</button>
				{policy.state === "active" && <span class="pill ok">active</span>}
				{policy.state === "absent" && (
					<span class={`pill ${sessionKind === "private-key" ? "warn" : ""}`}>
						none set
					</span>
				)}
				{policy.state === "unreadable" && <span class="pill err">unreadable</span>}
				<span class="chevron muted">{isOpen ? "▾" : "▸"}</span>
			</div>

			{isOpen && (
				<>
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
													write(
														`Removing ${row.rule}…`,
														"clear_policy_rule",
														{ rule: row.rule }
													)
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
								onInput={(e) =>
									setDraft({ ...draft, value: e.currentTarget.value })
								}
								placeholder="0.05"
								aria-label="Value"
							/>
							<button type="submit" disabled={pending !== null}>
								{pending ?? "Set"}
							</button>
							{/* The caveat that has to be here and must not take
							    three lines of the card: maxValue bounds native
							    value only, and the README once claimed
							    otherwise. */}
							<span
								class="info"
								title="maxValue caps the native value of one transaction. It does not bound token amounts — an ERC-20 transfer carries value 0 — so use allowedDestinations to bound where tokens may go."
							>
								ⓘ
							</span>
						</form>
					)}

					{policy.state !== "absent" && (
						<div class="row">
							{confirmingWipe ? (
								<>
									<span class="muted">
										Remove the whole policy? Nothing will limit signing
										afterwards.
									</span>
									{/* `danger` here, and not on Keep: on the imported-key
									    signing path the local policy is the only bound on
									    what can be signed, so the button that destroys it
									    must not look like the one that backs out. */}
									<button
										class="ghost danger"
										data-action="wipe-confirm"
										disabled={pending !== null}
										onClick={() => {
											setConfirmingWipe(false);
											void write(
												"Removing the policy…",
												"clear_policy_rule",
												{
													all: true,
												}
											);
										}}
									>
										Remove
									</button>
									<button
										class="ghost"
										data-action="wipe-keep"
										disabled={pending !== null}
										onClick={() => setConfirmingWipe(false)}
									>
										Keep
									</button>
								</>
							) : (
								<button
									class="ghost danger"
									data-action="wipe"
									disabled={pending !== null}
									onClick={() => setConfirmingWipe(true)}
								>
									Remove whole policy
								</button>
							)}
						</div>
					)}
					{error && (
						<>
							<p class="error">{error.title}</p>
							{error.detail && <p class="muted">{error.detail}</p>}
							{error.raw && (
								<details>
									<summary>details</summary>
									<pre class="mono">{error.raw}</pre>
								</details>
							)}
						</>
					)}
				</>
			)}
		</div>
	);
}
