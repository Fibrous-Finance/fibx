// Fetch with timeout — wraps fetch() with an AbortController that auto-cancels.
export async function fetchWithTimeout(
	url: string,
	options?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
	const { timeoutMs = 15_000, ...fetchOptions } = options ?? {};
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		return await fetch(url, { ...fetchOptions, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}
