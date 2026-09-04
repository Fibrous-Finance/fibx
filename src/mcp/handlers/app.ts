import { handleGetAuthStatus } from "./auth.js";
import { handleGetBalance } from "./wallet.js";
import { handleGetPolicy } from "./policy.js";
import { handleGetQuote } from "./quote.js";
import { jsonResult, unwrapJson } from "./utils.js";
import { getTokens, type Token } from "../../services/fibrous/tokens.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { DEFAULT_SLIPPAGE } from "../../lib/config.js";

type AuthStatus = { authenticated: boolean; [k: string]: unknown };
type Balances = { balances: Record<string, string> };

export type OpenFibxArgs = {
	chain: string;
	from?: string;
	to?: string;
	amount?: string;
	slippage?: number;
};

/**
 * One snapshot for the app widget: everything the widget needs to draw itself
 * on first paint, composed from the handlers that already exist.
 *
 * Only auth and policy are required. Balances and the quote are attempted
 * and, when they fail, reported as absent — the app must open on a bad token
 * symbol or a slow RPC, because opening is how the user fixes either.
 */
export async function handleOpenFibx({ chain, from, to, amount, slippage }: OpenFibxArgs) {
	const auth = unwrapJson<AuthStatus>(await handleGetAuthStatus({ chain }));
	const policy = unwrapJson<unknown>(await handleGetPolicy());

	let balances: Record<string, string> | null = null;
	if (auth.authenticated) {
		try {
			balances = unwrapJson<Balances>(await handleGetBalance({ chain })).balances;
		} catch {
			balances = null;
		}
	}

	const terms =
		from && to && amount ? { from, to, amount, slippage: slippage ?? DEFAULT_SLIPPAGE } : null;

	let quote: unknown = null;
	let quoteError: string | null = null;
	if (terms) {
		try {
			quote = unwrapJson<unknown>(
				await handleGetQuote({
					amount: terms.amount,
					from_token: terms.from,
					to_token: terms.to,
					chain,
					slippage: terms.slippage,
				})
			);
		} catch (e) {
			quoteError = e instanceof Error ? e.message : String(e);
		}
	}

	return jsonResult({
		chain: getChainConfig(chain).name,
		auth,
		balances,
		policy,
		terms,
		quote,
		quoteError,
	});
}

export type TokenInfo = Pick<Token, "symbol" | "name" | "address" | "decimals" | "price">;

/** The chain's token list for the widget's picker. Headless; never bound to UI. */
export async function handleListTokens({ chain }: { chain: string }) {
	const chainConfig = getChainConfig(chain);
	const map = await getTokens(chainConfig);
	const tokens: TokenInfo[] = Object.values(map)
		.map(({ symbol, name, address, decimals, price }) => ({
			symbol,
			name,
			address,
			decimals,
			...(price !== undefined ? { price } : {}),
		}))
		.sort((a, b) => a.symbol.localeCompare(b.symbol));
	return jsonResult({ chain: chainConfig.name, tokens });
}
