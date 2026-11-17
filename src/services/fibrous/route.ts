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
export function verifyRoute(
	json: unknown,
	chain: ChainConfig,
	params: RouteParams
): RouteAndCallDataResponse {
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

	verifyMatchesRequest(data, chain, params);
	return data;
}

const SLIPPAGE_SCALE = 100_000_000n; // slippage percent × 10⁶, over 100 × 10⁶

/**
 * Checks, locally, that the calldata is the swap that was asked for.
 *
 * The router contract takes `amount_in` of `token_in` from the sender and
 * reverts unless at least `min_received` of `token_out` reaches
 * `destination` (the field names in its ABI, src/services/fibrous/abi/). So:
 *
 * - token_in / token_out equal the request, except that a native token is
 *   carried as the chain's wrapped native address: the API sends swap_type 0
 *   for a native input and 1 for a native output, 2 for token to token. A
 *   literal comparison would refuse every native swap.
 * - amount_in equals the requested amount, and destination the requested one
 *   (case-insensitively; the API echoes the request's letter case).
 * - min_received is not below the quoted output less the requested slippage.
 *   The API computes outputAmount × (1 − slippage/100) rounded up (1786442 at
 *   0.5% gives 1777510); this refuses only below the exact value rounded down,
 *   less one base unit for float error in the slippage, never on inequality.
 *
 * What this does not prove: that the quoted output is a fair price.
 * outputAmount comes from the same response, so a response that quotes low
 * and floors low is consistent and passes. The slippage bound and the user's
 * own reading of the quote are the defence there.
 */
function verifyMatchesRequest(
	data: RouteAndCallDataResponse,
	chain: ChainConfig,
	params: RouteParams
): void {
	const r = data.calldata.route;
	const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
	const nativeIn = same(params.tokenInAddress, chain.nativeTokenAddress);
	const nativeOut = same(params.tokenOutAddress, chain.nativeTokenAddress);
	const expectedIn = nativeIn ? chain.wrappedNativeAddress : params.tokenInAddress;
	const expectedOut = nativeOut ? chain.wrappedNativeAddress : params.tokenOutAddress;
	const expectedType = nativeIn ? 0 : nativeOut ? 1 : 2;

	if (!same(r.token_in, expectedIn)) {
		throw rejected(`it sells ${r.token_in}, not the requested ${params.tokenInAddress}.`);
	}
	if (!same(r.token_out, expectedOut)) {
		throw rejected(`it buys ${r.token_out}, not the requested ${params.tokenOutAddress}.`);
	}
	if (r.swap_type !== expectedType) {
		throw rejected(
			`its swap_type is ${r.swap_type}, where this pair needs ${expectedType} (0 native in, 1 native out, 2 token to token).`
		);
	}
	if (BigInt(r.amount_in) !== BigInt(params.amount)) {
		throw rejected(`it spends ${r.amount_in} base units, not the requested ${params.amount}.`);
	}
	if (!same(r.destination, params.destination)) {
		throw rejected(`it pays ${r.destination}, not ${params.destination}.`);
	}

	const slippage = params.slippage ?? DEFAULT_SLIPPAGE;
	const quoted = BigInt(data.route.outputAmount);
	const slip = BigInt(Math.round(slippage * 1_000_000));
	const floor = (quoted * (SLIPPAGE_SCALE - slip)) / SLIPPAGE_SCALE - 1n;
	if (BigInt(r.min_received) < floor) {
		throw rejected(
			`its minimum received, ${r.min_received}, is below the quoted ${quoted} less ${slippage}% slippage.`
		);
	}
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

				return verifyRoute(json, chain, params);
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
