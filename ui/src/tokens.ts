import type { TokenInfo } from "./types.js";

/**
 * Pinned at the top of the picker, per chain. A wish list: a symbol Fibrous
 * does not serve on that chain is skipped, not invented.
 */
export const POPULAR: Record<string, readonly string[]> = {
	base: ["ETH", "WETH", "USDC", "cbBTC", "DAI", "USDbC"],
	hyperevm: ["HYPE", "WHYPE", "USDC", "USDT", "UBTC", "UETH"],
	monad: ["MON", "WMON", "USDC", "USDT", "WETH", "WBTC"],
};

export function orderTokens(list: readonly TokenInfo[], chain: string): TokenInfo[] {
	const pins = POPULAR[chain] ?? [];
	const bySymbol = new Map(list.map((t) => [t.symbol.toUpperCase(), t]));
	const pinned = pins
		.map((s) => bySymbol.get(s.toUpperCase()))
		.filter((t): t is TokenInfo => t !== undefined);
	const pinnedSet = new Set(pinned.map((t) => t.symbol.toUpperCase()));
	const rest = list
		.filter((t) => !pinnedSet.has(t.symbol.toUpperCase()))
		.sort((a, b) => a.symbol.localeCompare(b.symbol));
	return [...pinned, ...rest];
}

/** Client-side; a few hundred tokens is not a search problem. */
export function filterTokens(list: readonly TokenInfo[], query: string): TokenInfo[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...list];
	const score = (t: TokenInfo): number => {
		const s = t.symbol.toLowerCase();
		const n = t.name.toLowerCase();
		if (s === q) return 0;
		if (s.startsWith(q)) return 1;
		if (n.startsWith(q)) return 2;
		if (s.includes(q) || n.includes(q)) return 3;
		return -1;
	};
	return list
		.map((t) => ({ t, k: score(t) }))
		.filter((x) => x.k >= 0)
		.sort((a, b) => a.k - b.k || a.t.symbol.localeCompare(b.t.symbol))
		.map((x) => x.t);
}
