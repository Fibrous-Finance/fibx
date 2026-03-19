import type { Hash } from "viem";
import { getPublicClient } from "../../services/chain/client.js";
import { getChainConfig } from "../../services/chain/constants.js";
import {
	createSpinner,
	outputResult,
	formatError,
	type OutputOptions,
	type GlobalOptions,
} from "../../lib/format.js";

export async function txStatusCommand(hash: string, opts: OutputOptions): Promise<void> {
	const spinner = createSpinner(`Fetching transaction ${hash.slice(0, 10)}...`).start();

	try {
		const globalOpts = opts as unknown as GlobalOptions;
		const chainName = globalOpts.chain || "base";
		const chain = getChainConfig(chainName);

		const publicClient = getPublicClient(chain);
		const txHash = hash as Hash;

		spinner.text = "Waiting for receipt...";
		const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

		spinner.succeed(receipt.status === "success" ? "Transaction confirmed" : "Transaction reverted");

		const explorerLink = chain.viemChain.blockExplorers?.default.url
			? `${chain.viemChain.blockExplorers.default.url}/tx/${hash}`
			: undefined;

		outputResult(
			{
				status: receipt.status,
				blockNumber: receipt.blockNumber.toString(),
				gasUsed: receipt.gasUsed.toString(),
				from: receipt.from,
				to: receipt.to,
				txHash: hash,
				...(explorerLink ? { explorer: explorerLink } : {}),
				chain: chain.name,
			},
			opts
		);
	} catch (error) {
		spinner.fail("Failed to fetch transaction");
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
