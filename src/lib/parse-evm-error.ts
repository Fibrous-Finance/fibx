// Maps raw EVM/viem errors to human-readable messages.
// Pattern-based matching, inspired by StarkFi's parse-starknet-error.ts.

const ERROR_MAP: [pattern: RegExp, message: string][] = [
	// --- Viem typed errors ---
	[/InsufficientFundsError/i, "Not enough funds for gas fees"],
	[/UserRejectedRequestError/i, "Transaction cancelled by user"],
	[/ContractFunctionRevertedError/i, "Contract call reverted — check amount and balance"],
	[
		/EstimateGasExecutionError/i,
		"Transaction simulation failed — likely insufficient balance or invalid params",
	],
	[/TransactionReceiptNotFoundError/i, "Transaction receipt not found — it may still be pending"],

	// --- Common EVM revert strings ---
	[/transfer amount exceeds balance/i, "Insufficient token balance for this transfer"],
	[
		/insufficient allowance/i,
		"Token approval required — run with --approve-max or increase allowance",
	],
	[/execution reverted/i, "Transaction would fail on-chain — check parameters and balance"],
	[/nonce too low/i, "Nonce conflict (pending tx?) — please retry"],
	[/replacement.*underpriced/i, "Gas price too low for replacement — increase gas and retry"],
	[/max fee per gas less than block/i, "Gas price below current network minimum"],
	[/insufficient funds/i, "Not enough funds for gas fees"],

	// --- Aave V3 custom errors ---
	[/HEALTH_FACTOR_LOWER/i, "Would lower health factor below liquidation threshold"],
	[/NO_DEBT_OF_SELECTED_TYPE/i, "No outstanding debt of this type to repay"],
	[/COLLATERAL_CANNOT_COVER/i, "Insufficient collateral for this borrow"],
	[/RESERVE_FROZEN/i, "This asset is currently frozen and cannot be used"],
	[/RESERVE_PAUSED/i, "This asset is currently paused"],

	// --- Network / RPC ---
	[/429|rate.?limit/i, "RPC rate limited — please retry in a moment"],
	[/ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i, "Network error — check your RPC connection"],
	[/502|503|504/i, "RPC server error — please retry"],
];

/**
 * Parses a raw EVM/viem error into a human-readable message.
 * Falls back to the original message (truncated) if no pattern matches.
 */
export function parseEvmError(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);

	for (const [pattern, message] of ERROR_MAP) {
		if (pattern.test(raw)) return message;
	}

	// Truncate overly long error dumps (common with RPC responses)
	return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}
