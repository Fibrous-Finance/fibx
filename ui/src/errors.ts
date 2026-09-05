import { ToolError } from "./rpc.js";

export type Explained = {
	title: string;
	detail?: string;
	/** The unmapped text, for a disclosure. Present only when nothing matched. */
	raw?: string;
	severity: "error" | "warning";
	/** Something the UI can offer: open the policy section, re-quote, open the picker. */
	action?: "policy" | "requote" | "pick";
};

export type ErrorContext = {
	symbol?: string;
	amount?: string;
	balance?: string;
};

function exceedsBalance(ctx: ErrorContext): boolean {
	if (ctx.amount === undefined || ctx.balance === undefined) return false;
	const a = Number(ctx.amount);
	const b = Number(ctx.balance);
	return Number.isFinite(a) && Number.isFinite(b) && a > b;
}

/**
 * A raw message never reaches the user. Known signatures become a sentence, a
 * severity and — where one exists — an action; anything else keeps its first
 * line as the headline and the whole text behind a disclosure.
 */
export function explainError(err: unknown, ctx: ErrorContext): Explained {
	const message = err instanceof Error ? err.message : String(err);
	const code = err instanceof ToolError ? err.code : undefined;
	const details = err instanceof ToolError ? err.details : undefined;

	if (code === "POLICY_BLOCKED") {
		const rule =
			details && typeof details === "object" && "rule" in details
				? String((details as { rule: unknown }).rule)
				: undefined;
		return {
			title: "Blocked by your signing policy",
			detail: rule
				? `The rule ${rule} refused it. Edit it below.`
				: `${message} Edit it below.`,
			severity: "error",
			action: "policy",
		};
	}

	if (code === "TOKEN_NOT_SUPPORTED" || /token not found|unknown token/i.test(message)) {
		return {
			title: `"${ctx.symbol ?? "That token"}" is not on this chain`,
			detail: "Pick one from the list.",
			severity: "error",
			action: "pick",
		};
	}

	if (/UserRejectedRequestError|user rejected|rejected the request/i.test(message)) {
		return {
			title: "Rejected in your wallet",
			detail: "Nothing was sent.",
			severity: "warning",
		};
	}

	if (/INSUFFICIENT_OUTPUT_AMOUNT|slippage|price moved/i.test(message)) {
		return {
			title: "The price moved",
			detail: "Refresh the quote, or raise slippage.",
			severity: "warning",
			action: "requote",
		};
	}

	// An estimateGas revert with an amount over the balance is the balance —
	// the RPC body says nothing useful, so it is not shown.
	if (
		exceedsBalance(ctx) ||
		/insufficient funds|transfer amount exceeds balance|InsufficientFundsError/i.test(message)
	) {
		const detail =
			ctx.symbol && ctx.amount && ctx.balance
				? `You have ${ctx.balance} ${ctx.symbol}; this needs ${ctx.amount}.`
				: "Not enough of the token, or not enough for gas.";
		return { title: "Insufficient balance", detail, severity: "error" };
	}

	// An estimateGas failure the rules above could not name is still a
	// simulation failure, not a headline: the RPC's URL and request body are
	// the raw text, and they stay behind the disclosure.
	if (/eth_estimateGas|estimateGas|Transaction creation failed/i.test(message)) {
		return {
			title: "The simulation failed",
			detail: "Nothing was sent. The network could not estimate it — often the balance does not cover the amount plus gas.",
			raw: message,
			severity: "error",
		};
	}

	const firstLine = message.split("\n")[0].trim();
	return {
		title: firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine,
		raw: message,
		severity: "error",
	};
}
