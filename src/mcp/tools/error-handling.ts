import { FibxError } from "../../lib/errors.js";
import { parseEvmError } from "../../lib/parse-evm-error.js";
import { jsonResult } from "../handlers/utils.js";

/**
 * Higher-order function that wraps MCP tool handlers with standardized error handling.
 * Catches errors, parses EVM error messages, and returns structured JSON error responses.
 *
 * Mirrors StarkFi's withErrorHandling pattern.
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
			const isFibxError = error instanceof FibxError;
			const message = error instanceof Error ? error.message : String(error);

			return jsonResult({
				success: false,
				error: parseEvmError(error),
				code: isFibxError ? error.code : "UNKNOWN_ERROR",
				...(isFibxError && error.details ? { details: error.details } : {}),
				rawMessage: message,
			});
		}
	};
}
