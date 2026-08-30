import { findFibxError } from "../../lib/format.js";
import { parseEvmError } from "../../lib/parse-evm-error.js";
import { jsonResult } from "../handlers/utils.js";

/**
 * Higher-order function that wraps MCP tool handlers with standardized error handling.
 * Catches errors, parses EVM error messages, and returns structured JSON error responses.
 *
 * Mirrors StarkFi's withErrorHandling pattern.
 *
 * The typed error is looked for down the whole `cause` chain, not just at the
 * top: the signing policy and the WalletConnect transport both throw from
 * inside viem, which rethrows its own error with ours as the cause. Matching
 * only the outermost error reported a refusal as `UNKNOWN_ERROR` with no
 * reason — which on this surface is worse than on the CLI's, because the agent
 * reading it is the thing being refused. `findFibxError` is the CLI's own walk,
 * so both surfaces now report the same code and the same message.
 */
export function withErrorHandling<
	T extends (...args: never[]) => Promise<{ content: { type: "text"; text: string }[] }>,
>(fn: T) {
	return async (
		...args: Parameters<T>
	): Promise<{ content: { type: "text"; text: string }[] }> => {
		try {
			return await fn(...args);
		} catch (error) {
			const typed = findFibxError(error);
			const message = error instanceof Error ? error.message : String(error);

			return jsonResult({
				success: false,
				error: typed ? typed.message : parseEvmError(error),
				code: typed ? typed.code : "UNKNOWN_ERROR",
				...(typed?.details ? { details: typed.details } : {}),
				rawMessage: message,
			});
		}
	};
}
