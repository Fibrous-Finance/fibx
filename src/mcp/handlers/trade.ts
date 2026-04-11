import type { Address } from "viem";
import { requireSession } from "../../services/auth/session.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { getPublicClient, getWalletClient } from "../../services/chain/client.js";
import { resolveToken } from "../../services/fibrous/tokens.js";
import { getRouteAndCallData, encodeSwapCalldata } from "../../services/fibrous/route.js";
import {
	getAllowance,
	encodeApprove,
	encodeDeposit,
	encodeWithdraw,
	waitForAllowance,
} from "../../services/chain/erc20.js";
import { formatAmount, parseAmount } from "../../lib/parseAmount.js";
import { validateAmount } from "../../lib/validation.js";
import { DEFAULT_SLIPPAGE } from "../../lib/config.js";
import { jsonResult } from "./utils.js";

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
	validateAmount(amount);

	if (fromToken.toLowerCase() === toToken.toLowerCase()) {
		throw new Error("Source and destination tokens cannot be the same.");
	}

	const chainConfig = getChainConfig(chain);
	const session = requireSession();
	const walletClient = getWalletClient(session, chainConfig);
	const publicClient = getPublicClient(chainConfig);
	const wallet = session.walletAddress as Address;

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

	// Wrap: native → wrapped
	if (isNativeInput && isWrappedOutput) {
		if (simulate) {
			return jsonResult({
				success: true,
				mode: "SIMULATION (no TX sent)",
				operation: "wrap",
				amountIn: amount,
				tokenIn: tokenIn.symbol,
				tokenOut: tokenOut.symbol,
				chain: chainConfig.name,
			});
		}

		const data = encodeDeposit();
		const hash = await walletClient.sendTransaction({
			to: chainConfig.wrappedNativeAddress as Address,
			data,
			value: amountBaseUnits,
		});
		const explorer = chainConfig.viemChain.blockExplorers?.default.url
			? `${chainConfig.viemChain.blockExplorers.default.url}/tx/${hash}`
			: undefined;
		return jsonResult({
			txHash: hash,
			amountIn: amount,
			amountOut: amount,
			tokenIn: tokenIn.symbol,
			tokenOut: tokenOut.symbol,
			router: chainConfig.wrappedNativeAddress,
			chain: chainConfig.name,
			explorer,
		});
	}

	// Unwrap: wrapped → native
	if (isWrappedInput && isNativeOutput) {
		if (simulate) {
			return jsonResult({
				success: true,
				mode: "SIMULATION (no TX sent)",
				operation: "unwrap",
				amountIn: amount,
				tokenIn: tokenIn.symbol,
				tokenOut: tokenOut.symbol,
				chain: chainConfig.name,
			});
		}

		const data = encodeWithdraw(amountBaseUnits);
		const hash = await walletClient.sendTransaction({
			to: chainConfig.wrappedNativeAddress as Address,
			data,
			value: 0n,
		});
		const explorer = chainConfig.viemChain.blockExplorers?.default.url
			? `${chainConfig.viemChain.blockExplorers.default.url}/tx/${hash}`
			: undefined;
		return jsonResult({
			txHash: hash,
			amountIn: amount,
			amountOut: amount,
			tokenIn: tokenIn.symbol,
			tokenOut: tokenOut.symbol,
			router: chainConfig.wrappedNativeAddress,
			chain: chainConfig.name,
			explorer,
		});
	}

	const routeData = await getRouteAndCallData(
		{
			amount: amountBaseUnits.toString(),
			tokenInAddress: tokenIn.address,
			tokenOutAddress: tokenOut.address,
			slippage: slippage ?? DEFAULT_SLIPPAGE,
			destination: wallet,
		},
		chainConfig
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
			const approveData = encodeApprove(routerAddress, amountBaseUnits);
			const approveTxHash = await walletClient.sendTransaction({
				to: tokenIn.address as Address,
				data: approveData,
				value: 0n,
			});

			await publicClient.waitForTransactionReceipt({
				hash: approveTxHash,
				confirmations: 1,
			});

			await waitForAllowance(
				publicClient,
				tokenIn.address as Address,
				wallet,
				routerAddress,
				amountBaseUnits
			);
		}
	}

	const swapData = encodeSwapCalldata(routeData.calldata, chainConfig);
	const value = isNativeInput ? amountBaseUnits : 0n;

	const estimatedGas = await publicClient.estimateGas({
		account: wallet,
		to: routerAddress,
		data: swapData,
		value,
	});

	const outputAmount = formatAmount(BigInt(routeData.route.outputAmount), tokenOut.decimals);

	if (simulate) {
		return jsonResult({
			success: true,
			mode: "SIMULATION (no TX sent)",
			amountIn: amount,
			amountOut: outputAmount,
			tokenIn: tokenIn.symbol,
			tokenOut: tokenOut.symbol,
			router: routerAddress,
			chain: chainConfig.name,
			estimatedGas: estimatedGas.toString(),
		});
	}

	const hash = await walletClient.sendTransaction({
		to: routerAddress,
		data: swapData,
		value,
	});

	const explorer = chainConfig.viemChain.blockExplorers?.default.url
		? `${chainConfig.viemChain.blockExplorers.default.url}/tx/${hash}`
		: undefined;
	return jsonResult({
		txHash: hash,
		amountIn: amount,
		amountOut: outputAmount,
		tokenIn: tokenIn.symbol,
		tokenOut: tokenOut.symbol,
		router: routerAddress,
		chain: chainConfig.name,
		explorer,
	});
}
