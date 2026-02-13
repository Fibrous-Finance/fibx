import type { Address } from "viem";
import { requireSession } from "../../services/auth/session.js";
import { getPrivyClient } from "../../services/privy/client.js";
import { getWalletClient } from "../../services/chain/client.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { encodeTransfer } from "../../services/chain/erc20.js";
import { resolveToken } from "../../services/fibrous/tokens.js";
import { validateAddress, validateAmount } from "../../lib/validation.js";
import { parseAmount } from "../../lib/parseAmount.js";
import { outputResult, outputError, withSpinner, type OutputOptions } from "../../lib/format.js";

export async function sendCommand(
	amount: string,
	recipient: string,
	tokenSymbol: string,
	opts: OutputOptions
): Promise<void> {
	try {
		validateAmount(amount);
		validateAddress(recipient);

		const globalOpts = opts as unknown as { chain?: string };
		const chainName = globalOpts.chain || "base";
		const chain = getChainConfig(chainName);

		const session = requireSession();
		const privy = getPrivyClient();
		const walletClient = getWalletClient(privy, session, chain);

		let txHash: `0x${string}`;
		let amountBigInt: bigint;
		const isEth = tokenSymbol.toUpperCase() === "ETH";

		if (isEth) {
			amountBigInt = parseAmount(amount, 18);
			txHash = await withSpinner(
				`Sending ${amount} ETH on ${chain.name}...`,
				async () => {
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
			const data = encodeTransfer(recipient as Address, amountBigInt);

			txHash = await withSpinner(
				`Sending ${amount} ${token.symbol} on ${chain.name}...`,
				async () => {
					return walletClient.sendTransaction({
						to: token.address as Address,
						data,
						value: 0n,
					});
				},
				opts
			);
		}

		outputResult(
			{
				txHash,
				amount,
				recipient,
				token: isEth ? "ETH" : tokenSymbol.toUpperCase(),
				chain: chain.name,
			},
			opts
		);
	} catch (error) {
		outputError(error, opts);
	}
}
