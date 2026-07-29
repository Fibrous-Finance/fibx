import { describe, it, expect } from "vitest";
import { buildChainAssets, sumUsd } from "./assets.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

const tokens = [
	{ address: WETH, symbol: "WETH", price: "2000" },
	{ address: USDC, symbol: "USDC", price: "1" },
];

const native = { symbol: "ETH", balance: "1.0", price: 2000 };

describe("buildChainAssets", () => {
	// Regression: wrapped native used to be skipped outright, so WETH/WHYPE/WMON
	// holdings were invisible and net worth was understated.
	it("includes wrapped native as a distinct holding", () => {
		const assets = buildChainAssets(
			native,
			[{ token: { address: WETH }, balance: "2.0" }],
			tokens,
			ZERO_ADDRESS
		);

		const weth = assets.find((a) => a.symbol === "WETH");
		expect(weth).toBeDefined();
		expect(weth!.usdValue).toBe(4000);

		// 1 ETH (2000) + 2 WETH (4000)
		expect(sumUsd(assets)).toBe(6000);
	});

	// The other half of the same trade-off: the zero-address placeholder mirrors
	// the native balance, so counting it too would double the native holding.
	it("skips the native placeholder address to avoid double counting", () => {
		const assets = buildChainAssets(
			native,
			[{ token: { address: ZERO_ADDRESS }, balance: "1.0" }],
			tokens,
			ZERO_ADDRESS
		);

		expect(assets).toHaveLength(1);
		expect(assets[0].symbol).toBe("ETH");
		expect(sumUsd(assets)).toBe(2000);
	});

	it("sorts assets by USD value descending", () => {
		const assets = buildChainAssets(
			native,
			[
				{ token: { address: USDC }, balance: "50" },
				{ token: { address: WETH }, balance: "3" },
			],
			tokens,
			ZERO_ADDRESS
		);

		expect(assets.map((a) => a.symbol)).toEqual(["WETH", "ETH", "USDC"]);
	});

	it("drops zero balances and omits native when empty", () => {
		const assets = buildChainAssets(
			{ symbol: "ETH", balance: "0", price: 2000 },
			[{ token: { address: USDC }, balance: "0" }],
			tokens,
			ZERO_ADDRESS
		);

		expect(assets).toEqual([]);
		expect(sumUsd(assets)).toBe(0);
	});

	it("prices unknown tokens at zero and labels them by truncated address", () => {
		const unknown = "0xabcdef0123456789abcdef0123456789abcdef01";
		const assets = buildChainAssets(
			{ symbol: "ETH", balance: "0", price: 2000 },
			[{ token: { address: unknown }, balance: "123" }],
			tokens,
			ZERO_ADDRESS
		);

		expect(assets[0].symbol).toBe(unknown.slice(0, 10));
		expect(assets[0].usdValue).toBe(0);
	});

	it("matches token metadata case-insensitively", () => {
		const assets = buildChainAssets(
			{ symbol: "ETH", balance: "0", price: 2000 },
			[{ token: { address: WETH.toUpperCase() }, balance: "1" }],
			tokens,
			ZERO_ADDRESS
		);

		expect(assets[0].symbol).toBe("WETH");
		expect(assets[0].usdValue).toBe(2000);
	});
});
