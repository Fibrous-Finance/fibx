import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "../../lib/errors.js";
import { SUPPORTED_CHAINS } from "../chain/constants.js";

const mocks = vi.hoisted(() => ({ fetchWithTimeout: vi.fn() }));
vi.mock("../../lib/fetch.js", () => ({ fetchWithTimeout: mocks.fetchWithTimeout }));

const { getRouteAndCallData, verifyRoute } = await import("./route.js");

const BASE = SUPPORTED_CHAINS.base!;
const ROUTER = "0x274602a953847d807231d2370072f5f4e4594b44";
const WALLET = "0x1111111111111111111111111111111111111111";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";
const NATIVE = "0x0000000000000000000000000000000000000000";

/**
 * A native → USDC response in the shape the live Base API returns: the native
 * input appears as WETH in the calldata with swap_type 0, and keys FibX never
 * reads (meta, routeId, symbol…) ride along.
 */
function response(overrides: { calldataRoute?: object; top?: object } = {}) {
	return {
		routeId: "r-1",
		meta: { apiVersion: "x" },
		route: {
			success: true,
			inputToken: {
				address: NATIVE,
				name: "Ether",
				symbol: "ETH",
				decimals: 18,
				price: 1832,
			},
			outputToken: { address: USDC, name: "USDC", symbol: "USDC", decimals: 6, price: 1 },
			inputAmount: "1000000000000000",
			outputAmount: "1786442",
		},
		calldata: {
			route: {
				token_in: WETH,
				token_out: USDC,
				amount_in: "1000000000000000",
				amount_out: "1786442",
				min_received: "1777510",
				destination: WALLET.toUpperCase().replace("0X", "0x"),
				swap_type: 0,
				...overrides.calldataRoute,
			},
			swap_parameters: [
				{
					token_in: WETH,
					token_out: USDC,
					rate: "1000000",
					protocol_id: "5",
					pool_address: "0xd0b53d9277642d899df5c87a3966a349a798f224",
					swap_type: 2,
					extra_data: "0x",
				},
			],
		},
		router_address: ROUTER,
		...overrides.top,
	};
}

describe("the route response's shape", () => {
	it("accepts the live shape and ignores keys it does not read", () => {
		const data = verifyRoute(response(), BASE);

		expect(data.router_address).toBe(ROUTER);
		expect(data).not.toHaveProperty("meta");
	});

	it.each([
		["a missing min_received", { calldataRoute: { min_received: undefined } }],
		["a non-numeric amount", { calldataRoute: { amount_in: "1e18" } }],
		["a destination that is not an address", { calldataRoute: { destination: "me" } }],
		["an unknown swap_type", { calldataRoute: { swap_type: 7 } }],
	])("refuses %s", (_name, overrides) => {
		expect(() => verifyRoute(response(overrides), BASE)).toThrow(
			expect.objectContaining({ code: ErrorCode.ROUTE_REJECTED })
		);
	});

	// A wrap pair (native → wrapped native) comes back successful with no
	// calldata. The swap and quote paths never ask for one, but if anything
	// did, it must fail closed and say why.
	it("refuses a wrap-pair response that carries no calldata", () => {
		const wrap = { ...response(), calldata: undefined };

		expect(() => verifyRoute(wrap, BASE)).toThrow(/calldata is .*Nothing was signed/);
	});
});

describe("the router", () => {
	it("refuses a response that names any router but the pinned one", () => {
		const other = "0x9999999999999999999999999999999999999999";

		expect(() => verifyRoute(response({ top: { router_address: other } }), BASE)).toThrow(
			`it names ${other} as the router, not the Fibrous router for base`
		);
	});

	it("is pinned to the same address on every offered chain", () => {
		for (const chain of ["base", "hyperevm", "monad"]) {
			expect(SUPPORTED_CHAINS[chain]!.routerAddress).toBe(ROUTER);
		}
	});
});

describe("getRouteAndCallData", () => {
	beforeEach(() => vi.clearAllMocks());

	function respond(body: unknown) {
		mocks.fetchWithTimeout.mockResolvedValue({ ok: true, json: async () => body });
	}

	const params = {
		amount: "1000000000000000",
		tokenInAddress: NATIVE,
		tokenOutAddress: USDC,
		slippage: 0.5,
		destination: WALLET,
	};

	it("returns a verified response", async () => {
		respond(response());

		await expect(getRouteAndCallData(params, BASE)).resolves.toMatchObject({
			router_address: ROUTER,
		});
	});

	// Asking again does not make a response safer to sign.
	it("refuses without retrying", async () => {
		respond(
			response({ top: { router_address: "0x9999999999999999999999999999999999999999" } })
		);

		await expect(getRouteAndCallData(params, BASE)).rejects.toMatchObject({
			code: ErrorCode.ROUTE_REJECTED,
		});
		expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(1);
	});
});
