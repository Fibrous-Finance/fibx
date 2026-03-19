import { FibxError, type ErrorCode } from "./errors.js";

export interface RetryOptions {
	/** Maximum number of retries (default: 2) */
	maxRetries?: number;
	/** Base delay in ms before first retry (default: 500) */
	baseDelayMs?: number;
	/** Only retry if FibxError code is in this list */
	retryOnCodes?: ErrorCode[];
	/** Custom retry filter — return false to fail immediately */
	shouldRetry?: (error: unknown) => boolean;
}

/**
 * Retries an async function with exponential backoff and jitter.
 *
 * - Jitter prevents thundering herd on rate limits
 * - FibxError codes can be filtered (non-retryable errors fail immediately)
 * - Custom shouldRetry callback for one-off filtering
 */
export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
	const { maxRetries = 2, baseDelayMs = 500, retryOnCodes, shouldRetry } = options ?? {};

	let lastError: unknown;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			// Non-retryable domain errors: fail immediately
			if (error instanceof FibxError && retryOnCodes?.length) {
				if (!retryOnCodes.includes(error.code)) throw error;
			}

			// Custom filter
			if (shouldRetry && !shouldRetry(error)) throw error;

			if (attempt < maxRetries) {
				// Exponential backoff + jitter (0-100ms)
				const jitter = Math.random() * 100;
				const delay = baseDelayMs * 2 ** attempt + jitter;
				await new Promise((r) => setTimeout(r, delay));
			}
		}
	}

	throw lastError;
}
