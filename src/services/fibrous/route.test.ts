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

type Overrides = { calldataRoute?: object; route?: object; top?: object };

/**
 * A native → USDC response in the shape the live Base API returns: the native
 * input appears as WETH in the calldata with swap_type 0, the destination is
 * echoed in the request's letter case, and keys FibX never reads (meta,
 * routeId, symbol…) ride along.
 */
function response(overrides: Overrides = {}) {
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
			...overrides.route,
		},
		calldata: {
			route: {
				token_in: WETH,
				token_out: USDC,
				amount_in: "1000000000000000",
				amount_out: "1786442",
				min_received: "1777510",
				destination: "0x1111111111111111111111111111111111111111"
					.toUpperCase()
					.replace("0X", "0x"),
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

/** The request response() answers: 0.001 ETH → USDC at 0.5%, paid to WALLET. */
const PARAMS = {
	amount: "1000000000000000",
	tokenInAddress: NATIVE,
	tokenOutAddress: USDC,
	slippage: 0.5,
	destination: WALLET,
};

const verify = (overrides: Overrides = {}, params: object = {}) =>
	verifyRoute(response(overrides), BASE, { ...PARAMS, ...params });

function refuses(overrides: Overrides, params: object, message: RegExp | string) {
	expect(() => verify(overrides, params)).toThrow(message);
	expect(() => verify(overrides, params)).toThrow(
		expect.objectContaining({ code: ErrorCode.ROUTE_REJECTED })
	);
}

describe("the route response's shape", () => {
	it("accepts the live shape and ignores keys it does not read", () => {
		const data = verify();

		expect(data.router_address).toBe(ROUTER);
		expect(data).not.toHaveProperty("meta");
	});

	it.each([
		["a missing min_received", { calldataRoute: { min_received: undefined } }],
		["a non-numeric amount", { calldataRoute: { amount_in: "1e18" } }],
		["a destination that is not an address", { calldataRoute: { destination: "me" } }],
		["an unknown swap_type", { calldataRoute: { swap_type: 7 } }],
	])("refuses %s", (_name, overrides) => {
		refuses(overrides, {}, /Nothing was signed/);
	});

	// A wrap pair (native → wrapped native) comes back successful with no
	// calldata. The swap and quote paths never ask for one, but if anything
	// did, it must fail closed and say why.
	it("refuses a wrap-pair response that carries no calldata", () => {
		const wrap = { ...response(), calldata: undefined };

		expect(() => verifyRoute(wrap, BASE, PARAMS)).toThrow(/calldata is .*Nothing was signed/);
	});
});

describe("the router", () => {
	it("refuses a response that names any router but the pinned one", () => {
		const other = "0x9999999999999999999999999999999999999999";

		refuses(
			{ top: { router_address: other } },
			{},
			`it names ${other} as the router, not the Fibrous router for base`
		);
	});

	it("is pinned to the same address on every offered chain", () => {
		for (const chain of ["base", "hyperevm", "monad"]) {
			expect(SUPPORTED_CHAINS[chain]!.routerAddress).toBe(ROUTER);
		}
	});
});

/**
 * The calldata must be the swap that was asked for. Native tokens are carried
 * as the chain's wrapped native with a matching swap_type, as the live API
 * returns them; everything else is compared literally (case-insensitively).
 */
describe("the calldata against the request", () => {
	it("accepts a native input carried as WETH with swap_type 0", () => {
		expect(() => verify()).not.toThrow();
	});

	it("accepts a native output carried as WETH with swap_type 1", () => {
		expect(() =>
			verify(
				{ calldataRoute: { token_in: USDC, token_out: WETH, swap_type: 1 } },
				{ tokenInAddress: USDC, tokenOutAddress: NATIVE }
			)
		).not.toThrow();
	});

	it("accepts token to token, literally and case-insensitively, with swap_type 2", () => {
		expect(() =>
			verify(
				{ calldataRoute: { token_in: USDC, token_out: WETH, swap_type: 2 } },
				{ tokenInAddress: USDC.toUpperCase().replace("0X", "0x"), tokenOutAddress: WETH }
			)
		).not.toThrow();
	});

	it("refuses another input token", () => {
		refuses({ calldataRoute: { token_in: USDC } }, {}, /it sells/);
	});

	it("refuses another output token", () => {
		refuses({ calldataRoute: { token_out: WETH } }, {}, /it buys/);
	});

	it("refuses a swap_type that does not match the pair", () => {
		refuses({ calldataRoute: { swap_type: 2 } }, {}, /swap_type is 2, where this pair needs 0/);
	});

	it("refuses a different input amount", () => {
		refuses({ calldataRoute: { amount_in: "2000000000000000" } }, {}, /it spends/);
	});

	it("refuses a different destination", () => {
		refuses(
			{ calldataRoute: { destination: "0x2222222222222222222222222222222222222222" } },
			{},
			/it pays/
		);
	});

	// The API rounds its floor up; FibX refuses only below the exact value
	// rounded down (less a unit), so these pairs from the live API must pass.
	it.each([
		["1786442", "1777510", 0.5],
		["1784676", "1766830", 1],
		["15", "15", 0.5],
	])("accepts the API's floor for a quote of %s (min %s at %s%%)", (out, min, slippage) => {
		expect(() =>
			verify(
				{
					route: { outputAmount: out },
					calldataRoute: { amount_out: out, min_received: min },
				},
				{ slippage }
			)
		).not.toThrow();
	});

	it("refuses a minimum received below the quote less the slippage", () => {
		// 1786442 less 0.5% is 1777509.79; 1777000 would let 0.53% go.
		refuses({ calldataRoute: { min_received: "1777000" } }, {}, /minimum received/);
		// A floor of zero is the case this check exists for.
		refuses({ calldataRoute: { min_received: "0" } }, {}, /minimum received/);
	});
});

describe("getRouteAndCallData", () => {
	beforeEach(() => vi.clearAllMocks());

	function respond(body: unknown) {
		mocks.fetchWithTimeout.mockResolvedValue({ ok: true, json: async () => body });
	}

	it("returns a verified response", async () => {
		respond(response());

		await expect(getRouteAndCallData(PARAMS, BASE)).resolves.toMatchObject({
			router_address: ROUTER,
		});
	});

	// Asking again does not make a response safer to sign.
	it("refuses without retrying", async () => {
		respond(
			response({ top: { router_address: "0x9999999999999999999999999999999999999999" } })
		);

		await expect(getRouteAndCallData(PARAMS, BASE)).rejects.toMatchObject({
			code: ErrorCode.ROUTE_REJECTED,
		});
		expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(1);
	});
});
