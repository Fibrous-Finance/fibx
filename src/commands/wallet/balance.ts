import type { Address } from "viem";
import { loadSession } from "../../services/auth/session.js";
import { getPublicClient } from "../../services/chain/client.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { getTokens } from "../../services/fibrous/tokens.js";
import { getBalances } from "../../services/fibrous/balances.js";
import { formatAmount } from "../../lib/parseAmount.js";
import {
	createSpinner,
	outputResult,
	formatTable,
	formatError,
	type OutputOptions,
	type GlobalOptions,
} from "../../lib/format.js";

export async function balanceCommand(opts: OutputOptions): Promise<void> {
	const spinner = createSpinner("Fetching balances...").start();

	try {
		const session = loadSession();
		if (!session) {
			spinner.fail("No active session. Run 'fibx auth login <email>' first.");
			return;
		}

		const globalOpts = opts as unknown as GlobalOptions;
		const chainName = globalOpts.chain || "base";
		const chainConfig = getChainConfig(chainName);
		const client = getPublicClient(chainConfig);
		const wallet = session.walletAddress as Address;

		spinner.text = `Fetching balances on ${chainConfig.name}...`;

		const tokensMap = await getTokens(chainConfig);
		const tokenList = Object.values(tokensMap);

		const [ethBalance, tokenBalances] = await Promise.all([
			client.getBalance({ address: wallet }),
			getBalances(tokenList, wallet, chainConfig),
		]);

		spinner.stop();

		if (opts.json) {
			const result: Record<string, string> = {};
			result[chainConfig.nativeSymbol] = formatAmount(ethBalance, 18);
			for (const item of tokenBalances) {
				const balanceVal = parseFloat(item.balance);
				if (balanceVal > 0) {
					const tokenAddr = item.token.address.toLowerCase();
					const token = tokenList.find((t) => t.address.toLowerCase() === tokenAddr);
					result[token ? token.symbol : tokenAddr] = item.balance;
				}
			}
			outputResult(
				{ wallet: session.walletAddress, chain: chainConfig.name, ...result },
				opts
			);
			return;
		}

		// Build table rows
		const rows: string[][] = [];
		const nativeBalance = formatAmount(ethBalance, 18);
		if (parseFloat(nativeBalance) > 0) {
			rows.push([chainConfig.nativeSymbol, nativeBalance]);
		}

		for (const item of tokenBalances) {
			const balanceVal = parseFloat(item.balance);
			if (balanceVal > 0) {
				const tokenAddr = item.token.address.toLowerCase();
				const token = tokenList.find((t) => t.address.toLowerCase() === tokenAddr);
				const symbol = token ? token.symbol : tokenAddr;
				rows.push([symbol, item.balance]);
			}
		}

		console.log(`\n  Wallet: ${session.walletAddress}`);
		console.log(`  Chain:  ${chainConfig.name}\n`);

		if (rows.length === 0) {
			console.log("  No balances found.\n");
			return;
		}

		console.log(formatTable(["Token", "Balance"], rows));
		console.log();
	} catch (error) {
		spinner.fail("Failed to fetch balances");
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
