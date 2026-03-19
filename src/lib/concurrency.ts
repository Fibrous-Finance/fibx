/**
 * Sliding-window concurrency — starts a new task as soon as one completes.
 * Never exceeds `concurrency` in-flight promises at once.
 *
 * Results where `fn` returns `undefined` are filtered out.
 */
export async function runConcurrent<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R | undefined>
): Promise<R[]> {
	const results: R[] = [];
	let index = 0;

	const worker = async () => {
		while (index < items.length) {
			const current = index++;
			const item = items[current];
			if (!item) continue;

			const result = await fn(item);
			if (result !== undefined) {
				results.push(result);
			}
		}
	};

	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);

	return results;
}
