import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
	getChainConfig: vi.fn(),
	getRouteAndCallData: vi.fn(),
	getProtocolNames: vi.fn(),
	resolveToken: vi.fn(),
}));

vi.mock("../../services/fibrous/route.js", () => ({
	getRouteAndCallData: mocks.getRouteAndCallData,
}));
vi.mock("../../services/fibrous/protocols.js", () => ({
	getProtocolNames: mocks.getProtocolNames,
}));
vi.mock("../../services/fibrous/tokens.js", () => ({ resolveToken: mocks.resolveToken }));
vi.mock("../../services/chain/constants.js", () => ({
	getChainConfig: mocks.getChainConfig,
}));

const { handleGetQuote } = await import("./quote.js");

function parse(result: { content: { type: string; text: string }[] }) {
	return JSON.parse(result.content[0].text) as Record<string, never>;
}

const ETH = { symbol: "ETH", address: "0xEeee", decimals: 18 };
const USDC = { symbol: "USDC", address: "0x8335", decimals: 6 };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getChainConfig.mockReturnValue({
		name: "base",
		nativeTokenAddress: "0x0000000000000000000000000000000000000000",
		wrappedNativeAddress: "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
	});
	mocks.resolveToken.mockImplementation(async (s: string) => (s === "ETH" ? ETH : USDC));
	mocks.getProtocolNames.mockResolvedValue(new Map([[1, "Uniswap V3"]]));
	// RouteToken is { name, address, decimals, price } — it carries no `symbol`.
	// Symbols come from resolveToken; only the prices are read off the route.
	mocks.getRouteAndCallData.mockResolvedValue({
		route: {
			inputToken: { name: "Ether", address: ETH.address, decimals: 18, price: 4000 },
			outputToken: { name: "USD Coin", address: USDC.address, decimals: 6, price: 1 },
			inputAmount: "1000000000000000000",
			outputAmount: "3960000000",
		},
		calldata: {
			route: { min_received: "3920400000" },
			swap_parameters: [
				{ protocol_id: "1", pool_address: "0xpool1" },
				{ protocol_id: "7", pool_address: "0xpool2" },
			],
		},
		router_address: "0xrouter",
	});
});

describe("get_quote's structured half", () => {
	// The prose is what the model reads; removing it would degrade every
	// text-only host. The data is what a card draws.
	it("keeps the prose fields", async () => {
		const out = parse(
			await handleGetQuote({
				amount: "1",
				from_token: "ETH",
				to_token: "USDC",
				chain: "base",
				slippage: 0.5,
			})
		);

		expect(out.input).toBe("1 ETH");
		expect(typeof out.rate).toBe("string");
	});

	it("returns the exact output and the slippage floor", async () => {
		const q = parse(
			await handleGetQuote({
				amount: "1",
				from_token: "ETH",
				to_token: "USDC",
				chain: "base",
				slippage: 0.5,
			})
		).quote as never as Record<string, unknown>;

		expect(q.outputAmount).toBe("3960");
		expect(q.minReceived).toBe("3920.4");
	});

	// 1 ETH at $4000 in, 3960 USDC at $1 out — one percent of value lost.
	it("derives price impact from the prices the route already carries", async () => {
		const q = parse(
			await handleGetQuote({
				amount: "1",
				from_token: "ETH",
				to_token: "USDC",
				chain: "base",
				slippage: 0.5,
			})
		).quote as never as Record<string, number>;

		expect(q.usdIn).toBeCloseTo(4000, 6);
		expect(q.usdOut).toBeCloseTo(3960, 6);
		expect(q.priceImpact).toBeCloseTo(1, 6);
	});

	it("names the hops it can and keeps the pool for the ones it cannot", async () => {
		const q = parse(
			await handleGetQuote({
				amount: "1",
				from_token: "ETH",
				to_token: "USDC",
				chain: "base",
				slippage: 0.5,
			})
		).quote as never as {
			route: { protocol: number; displayName?: string; pool: string }[];
		};

		expect(q.route).toEqual([
			{ protocol: 1, displayName: "Uniswap V3", pool: "0xpool1" },
			{ protocol: 7, pool: "0xpool2" },
		]);
	});

	// The names are decoration; the quote is the product.
	it("still quotes when the protocol lookup returns nothing", async () => {
		mocks.getProtocolNames.mockResolvedValue(new Map());

		const q = parse(
			await handleGetQuote({
				amount: "1",
				from_token: "ETH",
				to_token: "USDC",
				chain: "base",
				slippage: 0.5,
			})
		).quote as never as {
			route: { displayName?: string }[];
		};

		expect(q.route).toHaveLength(2);
		expect(q.route[0].displayName).toBeUndefined();
	});
});
