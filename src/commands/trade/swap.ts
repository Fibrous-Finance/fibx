import type { Address } from "viem";
import { requireSession } from "../../services/auth/session.js";
import { getWalletClient, getPublicClient } from "../../services/chain/client.js";
import { getChainConfig } from "../../services/chain/constants.js";
import {
	getAllowance,
	encodeApprove,
	encodeDeposit,
	encodeWithdraw,
	waitForAllowance,
} from "../../services/chain/erc20.js";
import { resolveToken } from "../../services/fibrous/tokens.js";
import { getRouteAndCallData, encodeSwapCalldata } from "../../services/fibrous/route.js";
import { DEFAULT_SLIPPAGE } from "../../lib/config.js";
import { validateAmount } from "../../lib/validation.js";
import { parseAmount, formatAmount } from "../../lib/parseAmount.js";
import {
	createSpinner,
	outputResult,
	formatError,
	type OutputOptions,
	type GlobalOptions,
} from "../../lib/format.js";

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
	const spinner = createSpinner("Resolving tokens...").start();

	try {
		validateAmount(amount);

		const globalOpts = opts as unknown as GlobalOptions;
		const chainName = globalOpts.chain || "base";
		const chain = getChainConfig(chainName);

		const session = requireSession();
		const walletClient = getWalletClient(session, chain);
		const publicClient = getPublicClient(chain);
		const wallet = session.walletAddress as Address;

		spinner.text = `Resolving tokens on ${chain.name}...`;
		const [tokenIn, tokenOut] = await Promise.all([
			resolveToken(from, chain),
			resolveToken(to, chain),
		]);

		const amountBaseUnits = parseAmount(amount, tokenIn.decimals);
		const isNativeInput =
			tokenIn.address.toLowerCase() === chain.nativeTokenAddress.toLowerCase();
		const isNativeOutput =
			tokenOut.address.toLowerCase() === chain.nativeTokenAddress.toLowerCase();
		const isWrappedInput =
			tokenIn.address.toLowerCase() === chain.wrappedNativeAddress.toLowerCase();
		const isWrappedOutput =
			tokenOut.address.toLowerCase() === chain.wrappedNativeAddress.toLowerCase();

		if (isNativeInput && isWrappedOutput) {
			spinner.text = `Wrapping ${amount} ${tokenIn.symbol} → ${tokenOut.symbol}...`;
			const hash = await walletClient.sendTransaction({
				to: chain.wrappedNativeAddress as Address,
				data: encodeDeposit(),
				value: amountBaseUnits,
			});
			spinner.succeed("Wrap confirmed");

			const explorerLink = chain.viemChain.blockExplorers?.default.url
				? `${chain.viemChain.blockExplorers.default.url}/tx/${hash}`
				: undefined;

			outputResult(
				{
					action: "Wrap",
					input: `${amount} ${tokenIn.symbol}`,
					output: `${amount} ${tokenOut.symbol}`,
					txHash: hash,
					...(explorerLink ? { explorer: explorerLink } : {}),
					chain: chain.name,
				},
				opts
			);
			return;
		}

		if (isWrappedInput && isNativeOutput) {
			spinner.text = `Unwrapping ${amount} ${tokenIn.symbol} → ${tokenOut.symbol}...`;
			const hash = await walletClient.sendTransaction({
				to: chain.wrappedNativeAddress as Address,
				data: encodeWithdraw(amountBaseUnits),
				value: 0n,
			});
			spinner.succeed("Unwrap confirmed");

			const explorerLink = chain.viemChain.blockExplorers?.default.url
				? `${chain.viemChain.blockExplorers.default.url}/tx/${hash}`
				: undefined;

			outputResult(
				{
					action: "Unwrap",
					input: `${amount} ${tokenIn.symbol}`,
					output: `${amount} ${tokenOut.symbol}`,
					txHash: hash,
					...(explorerLink ? { explorer: explorerLink } : {}),
					chain: chain.name,
				},
				opts
			);
			return;
		}

		spinner.text = "Finding best route...";
		const routeData = await getRouteAndCallData(
			{
				amount: amountBaseUnits.toString(),
				tokenInAddress: tokenIn.address,
				tokenOutAddress: tokenOut.address,
				slippage: opts.slippage ?? DEFAULT_SLIPPAGE,
				destination: wallet,
			},
			chain
		);

		const outputAmount = formatAmount(BigInt(routeData.route.outputAmount), tokenOut.decimals);
		const routerAddress = routeData.router_address as Address;

		// Route preview
		if (!opts.json) {
			spinner.stop();
			console.log(
				`\n  Route: ${amount} ${tokenIn.symbol} → ~${outputAmount} ${tokenOut.symbol}`
			);
			console.log(`  Slippage: ${opts.slippage ?? DEFAULT_SLIPPAGE}%\n`);
		}

		if (!isNativeInput) {
			const currentAllowance = await getAllowance(
				publicClient,
				tokenIn.address as Address,
				wallet,
				routerAddress
			);

			if (currentAllowance < amountBaseUnits) {
				const approveSpinner = createSpinner("Approving token spend...").start();
				const amountToApprove = opts.approveMax
					? 115792089237316195423570985008687907853269984665640564039457584007913129639935n
					: amountBaseUnits;
				const approveData = encodeApprove(routerAddress, amountToApprove);
				const approveTxHash = await walletClient.sendTransaction({
					to: tokenIn.address as Address,
					data: approveData,
					value: 0n,
				});

				approveSpinner.text = "Waiting for approval confirmation...";
				await publicClient.waitForTransactionReceipt({
					hash: approveTxHash,
					confirmations: 1,
				});

				await waitForAllowance(
					publicClient,
					tokenIn.address as Address,
					wallet,
					routerAddress,
					amountToApprove
				);
				approveSpinner.succeed("Token approved");
			}
		}

		const swapSpinner = createSpinner(
			`Swapping ${amount} ${tokenIn.symbol} → ${tokenOut.symbol}...`
		).start();

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
			swapSpinner.fail("Simulation failed");
			throw new Error(
				`Simulation failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}

		const hash = await walletClient.sendTransaction({
			to: routerAddress,
			data: swapData,
			value: value,
		});

		swapSpinner.succeed("Swap confirmed");

		const explorerLink = chain.viemChain.blockExplorers?.default.url
			? `${chain.viemChain.blockExplorers.default.url}/tx/${hash}`
			: undefined;

		outputResult(
			{
				input: `${amount} ${tokenIn.symbol}`,
				output: `~${outputAmount} ${tokenOut.symbol}`,
				txHash: hash,
				...(explorerLink ? { explorer: explorerLink } : {}),
				router: routerAddress,
				chain: chain.name,
			},
			opts
		);
	} catch (error) {
		spinner.fail("Swap failed");
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
