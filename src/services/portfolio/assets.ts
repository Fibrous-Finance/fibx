/**
 * Pure portfolio aggregation — no RPC, no session. Takes already-fetched
 * balances and turns them into priced, sorted assets.
 */

export interface Asset {
	symbol: string;
	balance: string;
	price: number;
	usdValue: number;
}

interface PricedToken {
	address: string;
	symbol: string;
	price?: string;
}

interface TokenBalance {
	token: { address: string };
	balance: string;
}

interface NativeInput {
	symbol: string;
	/** Decoded native balance, e.g. "1.25". */
	balance: string;
	price: number;
}

/**
 * Build the asset list for one chain.
 *
 * `nativePlaceholderAddress` is the pseudo-address (zero address) some balance
 * APIs use to report the native coin. It is skipped because the native balance
 * is supplied separately via `native` — counting both would double the total.
 *
 * Wrapped native (WETH/WHYPE/WMON) is deliberately NOT skipped: it is a real,
 * separately-held ERC-20 and excluding it understates net worth.
 */
export function buildChainAssets(
	native: NativeInput,
	tokenBalances: TokenBalance[],
	tokens: PricedToken[],
	nativePlaceholderAddress: string
): Asset[] {
	const assets: Asset[] = [];

	const nativeBalanceNum = parseFloat(native.balance);
	if (nativeBalanceNum > 0) {
		assets.push({
			symbol: native.symbol,
			balance: native.balance,
			price: native.price,
			usdValue: nativeBalanceNum * native.price,
		});
	}

	const tokensByAddress = new Map(tokens.map((t) => [t.address.toLowerCase(), t]));
	const placeholder = nativePlaceholderAddress.toLowerCase();

	for (const item of tokenBalances) {
		const balanceNum = parseFloat(item.balance);
		if (!(balanceNum > 0)) continue;

		const addr = item.token.address.toLowerCase();
		if (addr === placeholder) continue;

		const token = tokensByAddress.get(addr);
		const price = token?.price ? parseFloat(token.price) : 0;

		assets.push({
			symbol: token?.symbol ?? addr.slice(0, 10),
			balance: item.balance,
			price,
			usdValue: balanceNum * price,
		});
	}

	assets.sort((a, b) => b.usdValue - a.usdValue);
	return assets;
}

export function sumUsd(assets: Asset[]): number {
	return assets.reduce((sum, a) => sum + a.usdValue, 0);
}
