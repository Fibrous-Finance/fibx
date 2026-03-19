import type { Address } from "viem";
import { encodeFunctionData } from "viem";
import { FIBROUS_BASE_URL, DEFAULT_SLIPPAGE } from "../../lib/config.js";
import type { ChainConfig } from "../chain/constants.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";
import { withRetry } from "../../lib/retry.js";

export interface RouteToken {
	name: string;
	address: string;
	decimals: number;
	price: number;
}

export interface SwapParameter {
	token_in: string;
	token_out: string;
	rate: string;
	protocol_id: string;
	pool_address: string;
	swap_type: number;
	extra_data: string;
}

export interface RouteAndCallDataResponse {
	route: {
		success: boolean;
		inputToken: RouteToken;
		outputToken: RouteToken;
		inputAmount: string;
		outputAmount: string;
	};
	calldata: {
		route: {
			token_in: string;
			token_out: string;
			amount_in: string;
			amount_out: string;
			min_received: string;
			destination: string;
			swap_type: number;
		};
		swap_parameters: SwapParameter[];
	};
	router_address: string;
}

export interface RouteParams {
	amount: string;
	tokenInAddress: string;
	tokenOutAddress: string;
	slippage?: number;
	destination: string;
}

export async function getRouteAndCallData(
	params: RouteParams,
	chain: ChainConfig
): Promise<RouteAndCallDataResponse> {
	const slippage = params.slippage ?? DEFAULT_SLIPPAGE;

	const url = new URL(`${FIBROUS_BASE_URL}/${chain.fibrousNetwork}/v2/routeAndCallData`);
	url.searchParams.set("amount", params.amount);
	url.searchParams.set("tokenInAddress", params.tokenInAddress);
	url.searchParams.set("tokenOutAddress", params.tokenOutAddress);
	url.searchParams.set("slippage", slippage.toString());
	url.searchParams.set("destination", params.destination);

	try {
		const data = await withRetry(
			async () => {
				const res = await fetch(url.toString());

				if (!res.ok) {
					const body = await res.text().catch(() => "");
					throw new Error(`HTTP ${res.status}: ${body}`);
				}

				const json = (await res.json()) as RouteAndCallDataResponse;

				if (!json.route?.success) {
					throw new FibxError(
						ErrorCode.ROUTE_NOT_FOUND,
						"No route found for this swap pair"
					);
				}

				return json;
			},
			{
				maxRetries: 2,
				baseDelayMs: 500,
				shouldRetry: (err) =>
					!(err instanceof FibxError && err.code === ErrorCode.ROUTE_NOT_FOUND),
			}
		);

		return data;
	} catch (error) {
		if (error instanceof FibxError) throw error;
		throw new FibxError(
			ErrorCode.FIBROUS_ERROR,
			`Route fetch failed: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

export function encodeSwapCalldata(
	calldata: RouteAndCallDataResponse["calldata"],
	chain: ChainConfig
): `0x${string}` {
	const { route, swap_parameters } = calldata;

	return encodeFunctionData({
		abi: chain.routerAbi,
		functionName: "swap",
		args: [
			{
				token_in: route.token_in as Address,
				token_out: route.token_out as Address,
				amount_in: BigInt(route.amount_in),
				amount_out: BigInt(route.amount_out),
				min_received: BigInt(route.min_received),
				destination: route.destination as Address,
				swap_type: route.swap_type,
			},
			swap_parameters.map((sp) => ({
				token_in: sp.token_in as Address,
				token_out: sp.token_out as Address,
				rate: Number(sp.rate),
				protocol_id: Number(sp.protocol_id),
				pool_address: sp.pool_address as Address,
				swap_type: sp.swap_type,
				extra_data: (sp.extra_data ?? "0x") as `0x${string}`,
			})),
		],
	});
}
