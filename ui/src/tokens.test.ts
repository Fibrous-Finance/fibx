import { describe, expect, it } from "vitest";
import { filterTokens, orderTokens } from "./tokens.js";
import type { TokenInfo } from "./types.js";

const t = (symbol: string, name = symbol): TokenInfo => ({
	symbol,
	name,
	address: `0x${symbol}`,
	decimals: 18,
});
const LIST = [
	t("ZRO", "LayerZero"),
	t("USDC", "USD Coin"),
	t("ETH", "Ether"),
	t("AERO", "Aerodrome"),
];

describe("orderTokens", () => {
	// Popular first, in the pinned order; the rest alphabetically. A pinned
	// symbol absent from the list is simply skipped — the constant is a wish
	// list, not a claim about what Fibrous serves.
	it("pins the chain's popular tokens ahead of the alphabetical rest", () => {
		expect(orderTokens(LIST, "base").map((x) => x.symbol)).toEqual([
			"ETH",
			"USDC",
			"AERO",
			"ZRO",
		]);
	});

	it("falls back to alphabetical on a chain with no pins", () => {
		expect(orderTokens(LIST, "nowhere").map((x) => x.symbol)).toEqual([
			"AERO",
			"ETH",
			"USDC",
			"ZRO",
		]);
	});
});

describe("filterTokens", () => {
	it("matches symbol and name, case-insensitively", () => {
		expect(filterTokens(LIST, "usd").map((x) => x.symbol)).toEqual(["USDC"]);
		expect(filterTokens(LIST, "layer").map((x) => x.symbol)).toEqual(["ZRO"]);
	});

	it("returns everything for an empty query", () => {
		expect(filterTokens(LIST, "  ")).toHaveLength(4);
	});

	it("ranks a symbol prefix above a name match", () => {
		const list = [t("AERO", "Aerodrome"), t("XAE", "aero-ish")];
		expect(filterTokens(list, "ae").map((x) => x.symbol)).toEqual(["AERO", "XAE"]);
	});
});
