import type { Address } from "viem";
import { loadSession } from "../../services/auth/session.js";
import { getPublicClient } from "../../services/chain/client.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { getTokens } from "../../services/fibrous/tokens.js";
import { getBalances } from "../../services/fibrous/balances.js";
import { formatAmount } from "../../lib/parseAmount.js";
import { outputResult, outputError, withSpinner, type OutputOptions } from "../../lib/format.js";

export async function balanceCommand(opts: OutputOptions): Promise<void> {
	try {
		const session = loadSession();
		if (!session) {
			outputError("No active session. Run 'fibx auth login <email>' first.", opts);
			return;
		}

		const globalOpts = opts as unknown as { chain?: string };
		const chainName = globalOpts.chain || "base";
		const chainConfig = getChainConfig(chainName);
		const client = getPublicClient(chainConfig);
		const wallet = session.walletAddress as Address;

		const tokensMap = await getTokens(chainConfig);
		const tokenList = Object.values(tokensMap);

		const balances = await withSpinner(
			`Fetching balances on ${chainConfig.name}...`,
			async () => {
				const [ethBalance, tokenBalances] = await Promise.all([
					client.getBalance({ address: wallet }),
					getBalances(tokenList, wallet, chainConfig),
				]);

				return {
					eth: formatAmount(ethBalance, 18),
					tokens: tokenBalances,
				};
			},
			opts
		);

		const result: Record<string, string> = {};

		result[chainConfig.nativeSymbol] = balances.eth;

		for (const item of balances.tokens) {
			const balanceVal = parseFloat(item.balance);
			if (balanceVal > 0) {
				const tokenAddr = item.token.address.toLowerCase();
				const token = tokenList.find((t) => t.address.toLowerCase() === tokenAddr);
				const symbol = token ? token.symbol : tokenAddr;

				result[symbol] = item.balance;
			}
		}

		outputResult(
			{
				wallet: session.walletAddress,
				chain: chainConfig.name,
				...result,
			},
			opts
		);
	} catch (error) {
		outputError(error, opts);
	}
}
