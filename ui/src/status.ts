export type ConnectStatus = {
	status: "pending" | "connected" | "failed" | "unknown";
	address?: string;
	error?: string;
};

export type PollDecision =
	| { action: "poll"; attempt: number }
	| { action: "stop" }
	| { action: "expired" };

/** Roughly two minutes at one second per attempt. */
export const MAX_POLL_ATTEMPTS = 120;

/**
 * Pure so the polling rules are testable without a DOM or a timer. Only
 * "pending" is worth asking again about: connected is done, and failed and
 * unknown will not change by being asked twice.
 */
export function nextPoll(result: ConnectStatus, attempt: number): PollDecision {
	if (result.status !== "pending") return { action: "stop" };
	if (attempt >= MAX_POLL_ATTEMPTS) return { action: "expired" };
	return { action: "poll", attempt: attempt + 1 };
}

type ToolResultLike = { content?: Array<{ type: string; text?: string }> };

/**
 * Every fibx tool answers with a single text block holding JSON. Decode it in
 * one place, and fail loudly when the shape is not that — a silent `undefined`
 * would surface as a blank panel with nothing to grep for.
 */
export function parseToolJson<T>(result: ToolResultLike): T {
	const text = result.content?.find((c) => c.type === "text")?.text;
	if (text === undefined) throw new Error("Tool result carried no text block");
	return JSON.parse(text) as T;
}

export function shortAddress(address: string): string {
	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export type SessionKind = "walletconnect" | "privy" | "private-key";

export function describeSession(kind: SessionKind): {
	label: string;
	approvesPerTransaction: boolean;
	policyIsOnlyBound: boolean;
} {
	switch (kind) {
		case "walletconnect":
			return {
				label: "Your own wallet, over WalletConnect",
				approvesPerTransaction: true,
				policyIsOnlyBound: false,
			};
		case "privy":
			return {
				label: "A Privy wallet",
				approvesPerTransaction: false,
				policyIsOnlyBound: false,
			};
		case "private-key":
			return {
				label: "A private key on this machine",
				approvesPerTransaction: false,
				policyIsOnlyBound: true,
			};
	}
}
