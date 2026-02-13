import type { ChainConfig } from "../chain/constants.js";
import { FIBROUS_GRAPH_URL } from "../../lib/config.js";
import { readCache, writeCache } from "../../lib/cache.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

export interface Token {
	name: string;
	address: string;
	decimals: number;
	symbol: string;
}

export type TokenMap = Record<string, Token>;

export async function getTokens(chain: ChainConfig): Promise<TokenMap> {
	const CACHE_KEY = `tokens-${chain.fibrousNetwork}`;
	const cached = readCache<TokenMap>(CACHE_KEY);
	if (cached) return cached;

	try {
		const res = await fetch(`${FIBROUS_GRAPH_URL}/${chain.fibrousNetwork}/tokens`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const data = (await res.json()) as TokenMap;
		writeCache(CACHE_KEY, data);
		return data;
	} catch (error) {
		throw new FibxError(
			ErrorCode.FIBROUS_ERROR,
			`Failed to fetch tokens: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

export async function resolveToken(symbolOrAddress: string, chain: ChainConfig): Promise<Token> {
	const tokens = await getTokens(chain);
	const input = symbolOrAddress.toLowerCase();

	if (input.startsWith("0x")) {
		const token = Object.values(tokens).find((t) => t.address.toLowerCase() === input);
		if (token) return token;
	}

	const token = Object.values(tokens).find((t) => t.symbol.toLowerCase() === input);

	if (!token) {
		throw new FibxError(
			ErrorCode.TOKEN_NOT_SUPPORTED,
			`Token "${symbolOrAddress}" not found on ${chain.name}`
		);
	}

	return token;
}
