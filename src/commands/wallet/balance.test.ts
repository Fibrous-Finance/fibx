import { describe, expect, it } from "vitest";
import { listedTokenBalances } from "./balance.js";
import type { BalanceResponse } from "../../services/fibrous/balances.js";
import type { Token } from "../../services/fibrous/tokens.js";

const NATIVE = "0x0000000000000000000000000000000000000000";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function held(address: string, amount: string): BalanceResponse {
	return { token: { address, decimal: 18 }, balance: amount };
}

const TOKENS: Token[] = [
	{ name: "Ethereum", symbol: "ETH", address: NATIVE, decimals: 18 },
	{ name: "Wrapped Ether", symbol: "WETH", address: WETH, decimals: 18 },
	{ name: "USD Coin", symbol: "USDC", address: USDC, decimals: 6 },
];

describe("listedTokenBalances", () => {
	// Fibrous reports the native coin as a zero-address token, and `balance`
	// reads the native balance separately from the chain. Listing both printed
	// ETH twice, with the same figure on each row.
	it("drops the native placeholder", () => {
		expect(listedTokenBalances([held(NATIVE, "0.0004")], TOKENS, NATIVE)).toEqual([]);
	});

	// Wrapped native is a real, separately-held ERC-20; dropping it would
	// understate the wallet.
	it("keeps wrapped native", () => {
		expect(listedTokenBalances([held(WETH, "1.5")], TOKENS, NATIVE)).toEqual([
			{ symbol: "WETH", balance: "1.5" },
		]);
	});

	it("drops zero balances", () => {
		expect(listedTokenBalances([held(USDC, "0")], TOKENS, NATIVE)).toEqual([]);
	});

	it("falls back to the address for a token the list does not name", () => {
		const unlisted = "0x1111111111111111111111111111111111111111";

		expect(listedTokenBalances([held(unlisted, "2")], TOKENS, NATIVE)).toEqual([
			{ symbol: unlisted, balance: "2" },
		]);
	});

	// Addresses arrive from two sources with no shared casing convention.
	it("matches the placeholder whatever its casing", () => {
		expect(
			listedTokenBalances(
				[held("0X0000000000000000000000000000000000000000", "0.1")],
				TOKENS,
				NATIVE
			)
		).toEqual([]);
	});

	it("keeps the order it was given", () => {
		const rows = listedTokenBalances([held(USDC, "10"), held(WETH, "2")], TOKENS, NATIVE);

		expect(rows).toEqual([
			{ symbol: "USDC", balance: "10" },
			{ symbol: "WETH", balance: "2" },
		]);
	});
});
