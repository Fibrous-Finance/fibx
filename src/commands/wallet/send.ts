import type { Address } from "viem";
import { requireSession } from "../../services/auth/session.js";
import { getWalletClient, getPublicClient } from "../../services/chain/client.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { ERC20_ABI } from "../../services/chain/erc20.js";
import { resolveToken } from "../../services/fibrous/tokens.js";
import { validateAddress, validateAmount } from "../../lib/validation.js";
import { parseAmount } from "../../lib/parseAmount.js";
import {
	createSpinner,
	outputResult,
	formatError,
	type OutputOptions,
	type GlobalOptions,
} from "../../lib/format.js";

export async function sendCommand(
	amount: string,
	recipient: string,
	tokenSymbol: string,
	opts: OutputOptions
): Promise<void> {
	const spinner = createSpinner("Preparing transfer...").start();

	try {
		validateAmount(amount);
		validateAddress(recipient);

		const globalOpts = opts as unknown as GlobalOptions;
		const chainName = globalOpts.chain || "base";
		const chain = getChainConfig(chainName);

		const session = requireSession();
		const walletClient = getWalletClient(session, chain);
		const publicClient = getPublicClient(chain);
		const wallet = session.walletAddress as Address;

		let txHash: `0x${string}`;
		let amountBigInt: bigint;
		const isNative = tokenSymbol ? tokenSymbol.toUpperCase() === chain.nativeSymbol : true;
		const resolvedSymbol = tokenSymbol || chain.nativeSymbol;

		if (isNative) {
			amountBigInt = parseAmount(amount, 18);

			spinner.text = `Sending ${amount} ${resolvedSymbol} on ${chain.name}...`;

			try {
				await publicClient.estimateGas({
					account: wallet,
					to: recipient as Address,
					value: amountBigInt,
					data: undefined,
				});
			} catch (error) {
				spinner.fail("Simulation failed");
				throw new Error(
					`Simulation failed: ${error instanceof Error ? error.message : String(error)}`
				);
			}

			txHash = await walletClient.sendTransaction({
				to: recipient as Address,
				value: amountBigInt,
				data: undefined,
			});
		} else {
			spinner.text = `Resolving ${tokenSymbol}...`;
			const token = await resolveToken(tokenSymbol, chain);
			amountBigInt = parseAmount(amount, token.decimals);

			spinner.text = `Sending ${amount} ${token.symbol} on ${chain.name}...`;

			const { request } = await publicClient.simulateContract({
				address: token.address as Address,
				abi: ERC20_ABI,
				functionName: "transfer",
				args: [recipient as Address, amountBigInt],
				account: wallet,
			});

			txHash = await walletClient.writeContract(request);
		}

		spinner.succeed("Transfer confirmed");

		const explorerLink = chain.viemChain.blockExplorers?.default.url
			? `${chain.viemChain.blockExplorers.default.url}/tx/${txHash}`
			: undefined;

		outputResult(
			{
				amount,
				recipient,
				token: resolvedSymbol,
				txHash,
				...(explorerLink ? { explorer: explorerLink } : {}),
				chain: chain.name,
			},
			opts
		);
	} catch (error) {
		spinner.fail("Transfer failed");
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
