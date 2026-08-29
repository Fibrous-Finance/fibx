import type { Address } from "viem";
import { AUTH_HINT, loadSession } from "../../services/auth/session.js";
import { getPublicClient } from "../../services/chain/client.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { getTokens, type Token } from "../../services/fibrous/tokens.js";
import { getBalances, type BalanceResponse } from "../../services/fibrous/balances.js";
import { formatAmount } from "../../lib/parseAmount.js";
import {
	createSpinner,
	outputResult,
	formatTable,
	formatError,
	type OutputOptions,
	type GlobalOptions,
} from "../../lib/format.js";

/**
 * The token holdings worth showing, resolved to symbols.
 *
 * Fibrous reports the native coin as a zero-address token, and this command
 * reads the native balance separately from the chain — listing both printed the
 * same holding twice. Wrapped native (WETH/WHYPE/WMON) is deliberately kept: it
 * is a real, separately-held ERC-20, and dropping it would understate the
 * wallet. `portfolio` draws the same line for the same reason.
 */
export function listedTokenBalances(
	tokenBalances: BalanceResponse[],
	tokens: Token[],
	nativePlaceholderAddress: string
): { symbol: string; balance: string }[] {
	const bySymbol = new Map(tokens.map((t) => [t.address.toLowerCase(), t.symbol]));
	const placeholder = nativePlaceholderAddress.toLowerCase();

	const listed: { symbol: string; balance: string }[] = [];

	for (const item of tokenBalances) {
		if (!(parseFloat(item.balance) > 0)) continue;

		const address = item.token.address.toLowerCase();
		if (address === placeholder) continue;

		listed.push({ symbol: bySymbol.get(address) ?? address, balance: item.balance });
	}

	return listed;
}

export async function balanceCommand(opts: OutputOptions): Promise<void> {
	const spinner = createSpinner("Fetching balances...").start();

	try {
		const session = loadSession();
		if (!session) {
			spinner.fail(`No active session. ${AUTH_HINT}`);
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

		const listed = listedTokenBalances(
			tokenBalances,
			tokenList,
			chainConfig.nativeTokenAddress
		);

		if (opts.json) {
			const result: Record<string, string> = {};
			result[chainConfig.nativeSymbol] = formatAmount(ethBalance, 18);
			for (const { symbol, balance } of listed) {
				result[symbol] = balance;
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

		for (const { symbol, balance } of listed) {
			rows.push([symbol, balance]);
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
