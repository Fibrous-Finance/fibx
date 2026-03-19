import type { Address } from "viem";
import { requireSession } from "../../services/auth/session.js";
import { getWalletClient, getPublicClient } from "../../services/chain/client.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { ERC20_ABI } from "../../services/chain/erc20.js";
import { resolveToken } from "../../services/fibrous/tokens.js";
import { validateAddress, validateAmount } from "../../lib/validation.js";
import { parseAmount } from "../../lib/parseAmount.js";
import {
	outputResult,
	outputError,
	withSpinner,
	type OutputOptions,
	type GlobalOptions,
} from "../../lib/format.js";

export async function sendCommand(
	amount: string,
	recipient: string,
	tokenSymbol: string,
	opts: OutputOptions
): Promise<void> {
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
			txHash = await withSpinner(
				`Sending ${amount} ${resolvedSymbol} on ${chain.name}...`,
				async () => {
					// Simulate ETH send (estimateGas)
					try {
						await publicClient.estimateGas({
							account: wallet,
							to: recipient as Address,
							value: amountBigInt,
							data: undefined,
						});
					} catch (error) {
						throw new Error(
							`Simulation failed: ${error instanceof Error ? error.message : String(error)}`
						);
					}

					return walletClient.sendTransaction({
						to: recipient as Address,
						value: amountBigInt,
						data: undefined,
					});
				},
				opts
			);
		} else {
			const token = await resolveToken(tokenSymbol, chain);
			amountBigInt = parseAmount(amount, token.decimals);

			txHash = await withSpinner(
				`Sending ${amount} ${token.symbol} on ${chain.name}...`,
				async () => {
					// Simulate ERC20 Transfer
					const { request } = await publicClient.simulateContract({
						address: token.address as Address,
						abi: ERC20_ABI,
						functionName: "transfer",
						args: [recipient as Address, amountBigInt],
						account: wallet,
					});

					return walletClient.writeContract(request);
				},
				opts
			);
		}

		outputResult(
			{
				txHash,
				amount,
				recipient,
				token: isNative ? resolvedSymbol : resolvedSymbol.toUpperCase(),
				chain: chain.name,
			},
			opts
		);
	} catch (error) {
		outputError(error, opts);
	}
}
