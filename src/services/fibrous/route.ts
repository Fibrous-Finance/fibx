import type { Address } from "viem";
import { encodeFunctionData } from "viem";
import { z } from "zod";
import { FIBROUS_BASE_URL, DEFAULT_SLIPPAGE } from "../../lib/config.js";
import type { ChainConfig } from "../chain/constants.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";
import { withRetry } from "../../lib/retry.js";
import { fetchWithTimeout } from "../../lib/fetch.js";

/**
 * The route API's response, as far as FibX reads it.
 *
 * FibX signs what this response says — the router it names is the approval's
 * spender and the transaction's target, and its calldata is the swap — so the
 * shape is checked before anything is read, and a response that does not fit
 * is refused, not coerced. Keys FibX does not use are ignored.
 */
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "not an address");
const uint = z.string().regex(/^\d+$/, "not an unsigned integer string");
// Hop fields arrive as strings today; a number would encode the same.
const uintLike = z.union([uint, z.number().int().nonnegative()]).transform((v) => String(v));

const routeTokenSchema = z.object({
	name: z.string().optional(),
	address,
	decimals: z.number().int().nonnegative(),
	// Absent or null when the router has no price; quote.ts reports that as
	// unknown rather than as zero.
	price: z.number().nullable().optional(),
});

const swapParameterSchema = z.object({
	token_in: address,
	token_out: address,
	rate: uintLike,
	protocol_id: uintLike,
	pool_address: address,
	swap_type: z.number().int(),
	extra_data: z
		.string()
		.regex(/^0x[0-9a-fA-F]*$/, "not hex")
		.nullable()
		.optional(),
});

const routeAndCallDataSchema = z.object({
	route: z.object({
		success: z.literal(true),
		inputToken: routeTokenSchema,
		outputToken: routeTokenSchema,
		inputAmount: uint,
		outputAmount: uint,
	}),
	calldata: z.object({
		route: z.object({
			token_in: address,
			token_out: address,
			amount_in: uint,
			amount_out: uint,
			min_received: uint,
			destination: address,
			swap_type: z.number().int().min(0).max(2),
		}),
		swap_parameters: z.array(swapParameterSchema).min(1),
	}),
	router_address: address,
});

export type RouteAndCallDataResponse = z.infer<typeof routeAndCallDataSchema>;
export type RouteToken = RouteAndCallDataResponse["route"]["inputToken"];
export type SwapParameter = RouteAndCallDataResponse["calldata"]["swap_parameters"][number];

export interface RouteParams {
	amount: string;
	tokenInAddress: string;
	tokenOutAddress: string;
	slippage?: number;
	destination: string;
}

function rejected(reason: string): FibxError {
	return new FibxError(
		ErrorCode.ROUTE_REJECTED,
		`The route API's response was refused: ${reason} Nothing was signed.`
	);
}

/**
 * Parses a response and refuses one FibX should not sign.
 *
 * Exported for tests; getRouteAndCallData is the only production caller.
 */
export function verifyRoute(json: unknown, chain: ChainConfig): RouteAndCallDataResponse {
	const parsed = routeAndCallDataSchema.safeParse(json);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const where = issue?.path.join(".") || "response";
		// A wrap or unwrap pair comes back with an empty calldata.route; the swap
		// and quote paths handle those before asking for a route.
		throw rejected(`${where} is ${issue?.message ?? "malformed"}.`);
	}
	const data = parsed.data;

	if (data.router_address.toLowerCase() !== chain.routerAddress.toLowerCase()) {
		throw rejected(
			`it names ${data.router_address} as the router, not the Fibrous router for ${chain.name} (${chain.routerAddress}).`
		);
	}

	return data;
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
				const res = await fetchWithTimeout(url.toString());

				if (!res.ok) {
					const body = await res.text().catch(() => "");
					throw new Error(`HTTP ${res.status}: ${body}`);
				}

				const json = (await res.json()) as { route?: { success?: unknown } };

				if (!json.route?.success) {
					throw new FibxError(
						ErrorCode.ROUTE_NOT_FOUND,
						"No route found for this swap pair"
					);
				}

				return verifyRoute(json, chain);
			},
			{
				maxRetries: 2,
				baseDelayMs: 500,
				// Neither answer changes on a retry: no route is no route, and a
				// response FibX refuses to sign is not made safer by asking again.
				shouldRetry: (err) =>
					!(
						err instanceof FibxError &&
						(err.code === ErrorCode.ROUTE_NOT_FOUND ||
							err.code === ErrorCode.ROUTE_REJECTED)
					),
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
