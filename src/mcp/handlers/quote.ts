import { getChainConfig } from "../../services/chain/constants.js";
import { resolveToken } from "../../services/fibrous/tokens.js";
import { getRouteAndCallData } from "../../services/fibrous/route.js";
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
	const routeData = await getRouteAndCallData(
		{
			amount: amountBaseUnits.toString(),
			tokenInAddress: tokenIn.address,
			tokenOutAddress: tokenOut.address,
			slippage: slippage ?? DEFAULT_SLIPPAGE,
			destination: QUOTE_DESTINATION,
		},
		chainConfig
	);

	const outputAmount = formatAmount(BigInt(routeData.route.outputAmount), tokenOut.decimals);

	// Calculate exchange rate
	const inputNum = parseFloat(amount);
	const outputNum = parseFloat(outputAmount);
	const rate = inputNum > 0 ? (outputNum / inputNum).toFixed(4) : "N/A";

	return jsonResult({
		input: `${amount} ${tokenIn.symbol}`,
		output: `~${outputAmount} ${tokenOut.symbol}`,
		rate: `1 ${tokenIn.symbol} ≈ ${rate} ${tokenOut.symbol}`,
		slippage: `${slippage ?? DEFAULT_SLIPPAGE}%`,
		router: routeData.router_address,
		chain: chainConfig.name,
	});
}
