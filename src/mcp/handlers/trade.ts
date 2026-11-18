import { executeSwap } from "../../services/trade/swap.js";
import { jsonResult } from "./utils.js";

const SIMULATION = "SIMULATION (no TX sent)";

/**
 * The tool result is a contract: the FibX app and fibx-telegram-bot read these
 * fields. `estimatedGas` is gas units as a decimal string, where `fibx trade`
 * prints a fee in the native token.
 */
export async function handleSwapTokens({
	amount,
	from_token: fromToken,
	to_token: toToken,
	chain,
	slippage,
	simulate,
}: {
	amount: string;
	from_token: string;
	to_token: string;
	chain: string;
	slippage: number;
	simulate?: boolean;
}) {
	const outcome = await executeSwap({
		amount,
		from: fromToken,
		to: toToken,
		chain,
		slippage,
		simulate,
	});
	const tokens = { tokenIn: outcome.tokenIn.symbol, tokenOut: outcome.tokenOut.symbol };
	const chainName = outcome.chain.name;

	if (!outcome.simulated) {
		return jsonResult({
			txHash: outcome.hash,
			amountIn: amount,
			amountOut: outcome.amountOut,
			...tokens,
			router: outcome.router,
			chain: chainName,
			explorer: outcome.explorer,
		});
	}

	if (outcome.operation !== "swap") {
		return jsonResult({
			success: true,
			mode: SIMULATION,
			operation: outcome.operation,
			amountIn: amount,
			...tokens,
			chain: chainName,
			estimatedGas: outcome.gas?.toString(),
		});
	}

	return jsonResult({
		success: true,
		mode: SIMULATION,
		amountIn: amount,
		amountOut: outcome.amountOut,
		...tokens,
		router: outcome.router,
		chain: chainName,
		...(outcome.requiresApproval ? {} : { estimatedGas: outcome.gas?.toString() }),
		requiresApproval: outcome.requiresApproval,
	});
}
