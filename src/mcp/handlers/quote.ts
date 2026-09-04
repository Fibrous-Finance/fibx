import { getChainConfig } from "../../services/chain/constants.js";
import { resolveToken } from "../../services/fibrous/tokens.js";
import { getRouteAndCallData } from "../../services/fibrous/route.js";
import { getProtocolNames } from "../../services/fibrous/protocols.js";
import { DEFAULT_SLIPPAGE } from "../../lib/config.js";
import { validateAmount } from "../../lib/validation.js";
import { parseAmount, formatAmount } from "../../lib/parseAmount.js";
import { jsonResult } from "./utils.js";

// Dummy destination for route queries — does not affect route calculation
const QUOTE_DESTINATION = "0x0000000000000000000000000000000000000001";

export async function handleGetQuote({
	amount,
	from_token: fromToken,
	to_token: toToken,
	chain,
	slippage,
}: {
	amount: string;
	from_token: string;
	to_token: string;
	chain: string;
	slippage: number;
}) {
	validateAmount(amount);

	if (fromToken.toLowerCase() === toToken.toLowerCase()) {
		throw new Error("Source and destination tokens cannot be the same.");
	}

	const chainConfig = getChainConfig(chain);

	const [tokenIn, tokenOut] = await Promise.all([
		resolveToken(fromToken, chainConfig),
		resolveToken(toToken, chainConfig),
	]);

	const amountBaseUnits = parseAmount(amount, tokenIn.decimals);
	const isNativeInput =
		tokenIn.address.toLowerCase() === chainConfig.nativeTokenAddress.toLowerCase();
	const isNativeOutput =
		tokenOut.address.toLowerCase() === chainConfig.nativeTokenAddress.toLowerCase();
	const isWrappedInput =
		tokenIn.address.toLowerCase() === chainConfig.wrappedNativeAddress.toLowerCase();
	const isWrappedOutput =
		tokenOut.address.toLowerCase() === chainConfig.wrappedNativeAddress.toLowerCase();

	// Wrap: native → wrapped (1:1)
	if (isNativeInput && isWrappedOutput) {
		return jsonResult({
			input: `${amount} ${tokenIn.symbol}`,
			output: `${amount} ${tokenOut.symbol}`,
			rate: `1 ${tokenIn.symbol} = 1 ${tokenOut.symbol}`,
			operation: "wrap",
			chain: chainConfig.name,
		});
	}

	// Unwrap: wrapped → native (1:1)
	if (isWrappedInput && isNativeOutput) {
		return jsonResult({
			input: `${amount} ${tokenIn.symbol}`,
			output: `${amount} ${tokenOut.symbol}`,
			rate: `1 ${tokenIn.symbol} = 1 ${tokenOut.symbol}`,
			operation: "unwrap",
			chain: chainConfig.name,
		});
	}

	// Standard swap — fetch route from Fibrous
	const [routeData, protocolNames] = await Promise.all([
		getRouteAndCallData(
			{
				amount: amountBaseUnits.toString(),
				tokenInAddress: tokenIn.address,
				tokenOutAddress: tokenOut.address,
				slippage: slippage ?? DEFAULT_SLIPPAGE,
				destination: QUOTE_DESTINATION,
			},
			chainConfig
		),
		getProtocolNames(chainConfig),
	]);

	const outputAmount = formatAmount(BigInt(routeData.route.outputAmount), tokenOut.decimals);

	// Calculate exchange rate
	const inputNum = parseFloat(amount);
	const outputNum = parseFloat(outputAmount);
	const rate = inputNum > 0 ? (outputNum / inputNum).toFixed(4) : "N/A";

	const minReceived = formatAmount(
		BigInt(routeData.calldata.route.min_received),
		tokenOut.decimals
	);

	// Both USD prices come back with the route. Price impact is the value lost
	// between them — our derivation, not a number Fibrous returns, and computed
	// from spot prices rather than the pool's marginal price, so it is an
	// estimate.
	const usdIn = parseFloat(amount) * (routeData.route.inputToken.price ?? 0);
	const usdOut = parseFloat(outputAmount) * (routeData.route.outputToken.price ?? 0);
	const priceImpact = usdIn > 0 ? ((usdIn - usdOut) / usdIn) * 100 : 0;

	const route = routeData.calldata.swap_parameters.map((sp) => {
		const protocol = Number(sp.protocol_id);
		const displayName = protocolNames.get(protocol);
		return displayName
			? { protocol, displayName, pool: sp.pool_address }
			: { protocol, pool: sp.pool_address };
	});

	return jsonResult({
		input: `${amount} ${tokenIn.symbol}`,
		output: `~${outputAmount} ${tokenOut.symbol}`,
		rate: `1 ${tokenIn.symbol} ≈ ${rate} ${tokenOut.symbol}`,
		slippage: `${slippage ?? DEFAULT_SLIPPAGE}%`,
		router: routeData.router_address,
		chain: chainConfig.name,
		// Everything a card needs to draw the route, nested so no existing
		// field moves and no text-only caller notices.
		quote: {
			fromToken: tokenIn.symbol,
			toToken: tokenOut.symbol,
			inputAmount: amount,
			outputAmount,
			minReceived,
			slippage: slippage ?? DEFAULT_SLIPPAGE,
			usdIn,
			usdOut,
			priceImpact,
			route,
			routerAddress: routeData.router_address,
			chain: chainConfig.name,
		},
	});
}
