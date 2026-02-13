import type { Hash } from "viem";
import { getPublicClient } from "../../services/chain/client.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { outputResult, outputError, withSpinner, type OutputOptions } from "../../lib/format.js";

export async function txStatusCommand(hash: string, opts: OutputOptions): Promise<void> {
	try {
		const globalOpts = opts as unknown as { chain?: string };
		const chainName = globalOpts.chain || "base";
		const chain = getChainConfig(chainName);

		const publicClient = getPublicClient(chain);
		const txHash = hash as Hash;

		const receipt = await withSpinner(
			`Fetching transaction status for ${hash}...`,
			async () => {
				return publicClient.waitForTransactionReceipt({ hash: txHash });
			},
			opts
		);

		const explorerLink = chain.viemChain.blockExplorers?.default.url
			? `${chain.viemChain.blockExplorers.default.url}/tx/${hash}`
			: "N/A";

		outputResult(
			{
				status: receipt.status,
				blockNumber: receipt.blockNumber.toString(),
				gasUsed: receipt.gasUsed.toString(),
				from: receipt.from,
				to: receipt.to,
				explorerLink,
				chain: chain.name,
			},
			opts
		);
	} catch (error) {
		outputError(error, opts);
	}
}
