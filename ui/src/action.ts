import { canSwap, isLocked, type State } from "./machine.js";

/**
 * What the one primary button is for, right now. The card used to carry a
 * Simulate button, a Swap button and a red block in the middle explaining why
 * neither could be pressed; all three are this.
 */
export type Intent =
	| "connect"
	| "enter-amount"
	| "insufficient"
	| "quoting"
	| "simulate"
	| "simulating"
	| "swap"
	| "waiting"
	| "swap-again"
	| "unresolved"
	| "retry";

export type PrimaryAction = { intent: Intent; label: string; enabled: boolean };

export type PrimaryInput = {
	state: State;
	connected: boolean;
	/** The raw field, not the machine's terms: it is what the user typed. */
	amount: string;
	fromSymbol: string;
	/** The amount exceeds the balance the wallet actually holds. */
	short: boolean;
	/** A quote is debouncing or in flight. */
	quoting: boolean;
};

/**
 * Pure, and the only source of the button's label and of its `disabled`. The
 * order below is the whole safety argument, so it is written as one sequence
 * of returns rather than as flags that could be combined in the wrong order:
 *
 * - No wallet outranks everything — nothing else on the card can be acted on.
 * - `unknown` outranks every recoverable reading. A hash that never resolved
 *   is terminal, and a shortfall clearing or a fresh quote arriving must not
 *   re-arm a transaction that may already be in flight.
 * - The in-flight kinds report themselves before any judgement about the
 *   amount, so a call in progress is never described as a shortfall.
 * - The shortfall outranks a ready quote: the eth_estimateGas dump that
 *   started this came from letting a short amount reach swap_tokens.
 *
 * `enabled` is derived here and nowhere else, and the three intents that can
 * send a transaction additionally answer to the machine's own locks.
 */
export function primaryAction(input: PrimaryInput): PrimaryAction {
	const { state, connected, amount, fromSymbol, short, quoting } = input;
	const locked = isLocked(state);
	const go = (intent: Intent, label: string, enabled = false): PrimaryAction => ({
		intent,
		label,
		enabled,
	});

	if (!connected) return go("connect", "Connect wallet", true);
	if (state.kind === "unknown") return go("unresolved", "Unresolved — check the explorer");
	if (state.kind === "simulating") return go("simulating", "Simulating…");
	if (state.kind === "swapping" || state.kind === "broadcast") return go("waiting", "Waiting…");
	if (state.kind === "failed") return go("retry", "Try again", !locked);
	if (state.kind === "confirmed" || state.kind === "reverted")
		return go("swap-again", "Swap again", true);

	// An empty field and a typed "0" are the same request: name an amount.
	if (amount.trim() === "" || Number(amount) === 0) return go("enter-amount", "Enter an amount");
	if (short) return go("insufficient", `Insufficient ${fromSymbol} balance`);
	if (quoting) return go("quoting", "Fetching quote…");
	if (state.kind === "simulated") return go("swap", "Swap", canSwap(state) && !locked);
	if (state.kind === "quoted") return go("simulate", "Simulate", !locked);
	return go("enter-amount", "Enter an amount");
}
