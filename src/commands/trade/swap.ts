import type { Address } from "viem";
import { requireSession } from "../../services/auth/session.js";
import { getWalletClient, getPublicClient } from "../../services/chain/client.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { getAllowance, encodeApprove } from "../../services/chain/erc20.js";
import { resolveToken } from "../../services/fibrous/tokens.js";
import { getRouteAndCallData, encodeSwapCalldata } from "../../services/fibrous/route.js";
import { DEFAULT_SLIPPAGE } from "../../lib/config.js";
import { validateAmount } from "../../lib/validation.js";
import { parseAmount, formatAmount } from "../../lib/parseAmount.js";
import { outputResult, outputError, withSpinner, type OutputOptions } from "../../lib/format.js";

interface TradeOptions extends OutputOptions {
	slippage: number;
	approveMax?: boolean;
}

export async function tradeCommand(
	amount: string,
	from: string,
	to: string,
	opts: TradeOptions
): Promise<void> {
	try {
		validateAmount(amount);

		const globalOpts = opts as unknown as { chain?: string };
		const chainName = globalOpts.chain || "base";
		const chain = getChainConfig(chainName);

		const session = requireSession();
		const walletClient = getWalletClient(session, chain);
		const publicClient = getPublicClient(chain);
		const wallet = session.walletAddress as Address;

		const [tokenIn, tokenOut] = await withSpinner(
			`Resolving tokens on ${chain.name}...`,
			async () => Promise.all([resolveToken(from, chain), resolveToken(to, chain)]),
			opts
		);

		const amountBaseUnits = parseAmount(amount, tokenIn.decimals);
		const isNativeInput =
			tokenIn.address.toLowerCase() === chain.nativeTokenAddress.toLowerCase();

		const routeData = await withSpinner(
			"Finding best route...",
			async () => {
				return getRouteAndCallData(
					{
						amount: amountBaseUnits.toString(),
						tokenInAddress: tokenIn.address,
						tokenOutAddress: tokenOut.address,
						slippage: opts.slippage ?? DEFAULT_SLIPPAGE,
						destination: wallet,
					},
					chain
				);
			},
			opts
		);

		const routerAddress = routeData.router_address as Address;

		if (!isNativeInput) {
			const currentAllowance = await getAllowance(
				publicClient,
				tokenIn.address as Address,
				wallet,
				routerAddress
			);

			if (currentAllowance < amountBaseUnits) {
				await withSpinner(
					"Approving token spend...",
					async () => {
						const amountToApprove = opts.approveMax
							? 115792089237316195423570985008687907853269984665640564039457584007913129639935n
							: amountBaseUnits;
						const approveData = encodeApprove(routerAddress, amountToApprove);
						const approveTxHash = await walletClient.sendTransaction({
							to: tokenIn.address as Address,
							data: approveData,
							value: 0n,
						});

						await publicClient.waitForTransactionReceipt({
							hash: approveTxHash,
							confirmations: 1,
						});

						return approveTxHash;
					},
					opts
				);
			}
		}

		const hash = await withSpinner(
			`Swapping ${amount} ${tokenIn.symbol} → ${tokenOut.symbol}...`,
			async () => {
				const swapData = encodeSwapCalldata(routeData.calldata, chain);
				const value = isNativeInput ? amountBaseUnits : 0n;

				try {
					await publicClient.estimateGas({
						account: wallet,
						to: routerAddress,
						data: swapData,
						value: value,
					});
				} catch (error) {
					throw new Error(
						`Simulation failed: ${error instanceof Error ? error.message : String(error)}`
					);
				}

				return walletClient.sendTransaction({
					to: routerAddress,
					data: swapData,
					value: value,
				});
			},
			opts
		);

		const outputAmount = formatAmount(BigInt(routeData.route.outputAmount), tokenOut.decimals);

		outputResult(
			{
				txHash: hash,
				amountIn: amount,
				amountOut: outputAmount,
				tokenIn: tokenIn.symbol,
				tokenOut: tokenOut.symbol,
				router: routerAddress,
				chain: chain.name,
			},
			opts
		);
	} catch (error) {
		outputError(error, opts);
	}
}
