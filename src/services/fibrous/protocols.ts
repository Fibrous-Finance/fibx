import { FIBROUS_GRAPH_URL } from "../../lib/config.js";
import { readCache, writeCache } from "../../lib/cache.js";
import { fetchWithTimeout } from "../../lib/fetch.js";
import type { ChainConfig } from "../chain/constants.js";

interface LiquiditySource {
	protocol: number;
	display_name: string;
	amm_name?: string;
	image_url?: string | null;
}

/**
 * Maps Fibrous protocol ids to the names a person recognises, from the same
 * endpoint fibrous-interface uses.
 *
 * It never rejects. These names are decoration on a route the user can swap
 * through either way, and a quote that failed because a cosmetic lookup failed
 * would be the worse outcome by a wide margin.
 *
 * No `withRetry` here, and a shorter timeout than the 15s default: this runs
 * in parallel with the route fetch, so every second it spends failing is a
 * second the quote is not ready. Retrying a decoration would invert that.
 */
export async function getProtocolNames(chain: ChainConfig): Promise<Map<number, string>> {
	const cacheKey = `protocols-${chain.fibrousNetwork}`;

	try {
		const cached = readCache<LiquiditySource[]>(cacheKey);
		if (cached) return toMap(cached);

		const res = await fetchWithTimeout(
			`${FIBROUS_GRAPH_URL}/${chain.fibrousNetwork}/protocols`,
			{
				timeoutMs: 5_000,
			}
		);
		if (!res.ok) return new Map();

		const sources = (await res.json()) as LiquiditySource[];
		if (!Array.isArray(sources)) return new Map();

		writeCache(cacheKey, sources);
		return toMap(sources);
	} catch {
		return new Map();
	}
}

function toMap(sources: LiquiditySource[]): Map<number, string> {
	const names = new Map<number, string>();
	for (const s of sources) {
		if (typeof s?.protocol === "number" && s.display_name) {
			names.set(s.protocol, s.display_name);
		}
	}
	return names;
}
