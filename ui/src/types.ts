import type { QuoteResult } from "./quote.js";

export type SessionKind = "walletconnect" | "privy" | "private-key";

export type AuthStatus = {
	authenticated: boolean;
	walletAddress: string | null;
	sessionType: SessionKind | null;
	chain: string;
	requiresApprovalPerTransaction: boolean;
	fibrousStatus: string;
};

export type Policy = {
	maxValue?: Record<string, string>;
	allowedChains?: string[];
	allowedDestinations?: Record<string, string[]>;
	expiry?: string;
};

export type PolicyState =
	| { state: "active"; rules: Policy; path: string }
	| { state: "absent"; path: string; message: string }
	| { state: "unreadable"; path: string; message: string };

export type Terms = { from: string; to: string; amount: string; slippage: number };

/** What open_fibx returns. Mirrors src/mcp/handlers/app.ts exactly. */
export type Snapshot = {
	chain: string;
	auth: AuthStatus;
	balances: Record<string, string> | null;
	policy: PolicyState;
	terms: Terms | null;
	quote: QuoteResult | null;
	quoteError: string | null;
};

export type TokenInfo = {
	symbol: string;
	name: string;
	address: string;
	decimals: number;
	price?: string;
};

export type TokenList = { chain: string; tokens: TokenInfo[] };

export type Pairing = { uri: string; qrDataUri: string; pairingId: string };

export type SimulateResult = {
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

export type BroadcastResult = {
	txHash: string;
	amountIn: string;
	amountOut: string;
	tokenIn: string;
	tokenOut: string;
	chain: string;
	explorer?: string;
};

export type TxStatusResult = {
	hash: string;
	status: "confirmed" | "reverted";
	blockNumber: string;
	explorer?: string;
};
