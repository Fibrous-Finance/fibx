import type { Address } from "viem";
import { loadSession, requireSession } from "../../services/auth/session.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { getPublicClient, getWalletClient } from "../../services/chain/client.js";
import { getTokens, resolveToken } from "../../services/fibrous/tokens.js";
import { getBalances } from "../../services/fibrous/balances.js";
import { ERC20_ABI } from "../../services/chain/erc20.js";
import { formatAmount, parseAmount } from "../../lib/parseAmount.js";
import { validateAmount, validateAddress } from "../../lib/validation.js";
import { jsonResult } from "./utils.js";

export async function handleGetBalance({ chain }: { chain: string }) {
	const session = loadSession();
	if (!session) {
		throw new Error("No active session. Run 'fibx auth login <email>' first.");
	}

	const chainConfig = getChainConfig(chain);
	const client = getPublicClient(chainConfig);
	const wallet = session.walletAddress as Address;

	const tokensMap = await getTokens(chainConfig);
	const tokenList = Object.values(tokensMap);

	const [ethBalance, tokenBalances] = await Promise.all([
		client.getBalance({ address: wallet }),
		getBalances(tokenList, wallet, chainConfig),
	]);

	const balances: Record<string, string> = {};
	balances[chainConfig.nativeSymbol] = formatAmount(ethBalance, 18);

	for (const item of tokenBalances) {
		const balanceVal = parseFloat(item.balance);
		if (balanceVal > 0) {
			const tokenAddr = item.token.address.toLowerCase();
			const token = tokenList.find((t) => t.address.toLowerCase() === tokenAddr);
			const symbol = token ? token.symbol : tokenAddr;
			balances[symbol] = item.balance;
		}
	}

	return jsonResult({ wallet: session.walletAddress, chain: chainConfig.name, balances });
}

export async function handleSendTokens({
	amount,
	recipient,
	token,
	chain,
	simulate,
}: {
	amount: string;
	recipient: string;
	token?: string;
	chain: string;
	simulate?: boolean;
}) {
	validateAmount(amount);
	validateAddress(recipient);

	const chainConfig = getChainConfig(chain);
	const session = requireSession();
	const walletClient = getWalletClient(session, chainConfig);
	const publicClient = getPublicClient(chainConfig);
	const wallet = session.walletAddress as Address;
	const to = recipient as Address;

	const isNative = token ? token.toUpperCase() === chainConfig.nativeSymbol : true;
	const resolvedSymbol = token || chainConfig.nativeSymbol;

	if (isNative) {
		const amountBaseUnits = parseAmount(amount, 18);

		const estimatedGas = await publicClient.estimateGas({
			account: wallet,
			to,
			value: amountBaseUnits,
			data: undefined,
		});

		if (simulate) {
			return jsonResult({
				success: true,
				mode: "SIMULATION (no TX sent)",
				amount,
				token: resolvedSymbol,
				recipient,
				chain: chainConfig.name,
				estimatedGas: estimatedGas.toString(),
			});
		}

		const hash = await walletClient.sendTransaction({
			to,
			value: amountBaseUnits,
			data: undefined,
		});

		const explorer = chainConfig.viemChain.blockExplorers?.default.url
			? `${chainConfig.viemChain.blockExplorers.default.url}/tx/${hash}`
			: undefined;
		return jsonResult({
			txHash: hash,
			amount,
			token: resolvedSymbol,
			recipient,
			chain: chainConfig.name,
			explorer,
		});
	}

	const resolved = await resolveToken(token!, chainConfig);
	const amountBaseUnits = parseAmount(amount, resolved.decimals);

	const { request } = await publicClient.simulateContract({
		address: resolved.address as Address,
		abi: ERC20_ABI,
		functionName: "transfer",
		args: [to, amountBaseUnits],
		account: wallet,
	});

	if (simulate) {
		return jsonResult({
			success: true,
			mode: "SIMULATION (no TX sent)",
			amount,
			token: resolved.symbol,
			recipient,
			chain: chainConfig.name,
		});
	}

	const hash = await walletClient.writeContract(request);

	const explorer = chainConfig.viemChain.blockExplorers?.default.url
		? `${chainConfig.viemChain.blockExplorers.default.url}/tx/${hash}`
		: undefined;
	return jsonResult({
		txHash: hash,
		amount,
		token: resolved.symbol,
		recipient,
		chain: chainConfig.name,
		explorer,
	});
}

export async function handleGetTxStatus({ hash, chain }: { hash: string; chain: string }) {
	const chainConfig = getChainConfig(chain);
	const client = getPublicClient(chainConfig);

	const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });

	const explorer = chainConfig.viemChain.blockExplorers?.default.url
		? `${chainConfig.viemChain.blockExplorers.default.url}/tx/${hash}`
		: undefined;
	return jsonResult({
		hash,
		status: receipt.status === "success" ? "confirmed" : "reverted",
		blockNumber: receipt.blockNumber.toString(),
		from: receipt.from,
		to: receipt.to ?? null,
		gasUsed: receipt.gasUsed.toString(),
		chain: chainConfig.name,
		explorer,
	});
}

export async function handleGetPortfolio() {
	const { getPortfolio } = await import("../../services/portfolio/portfolio.js");
	const portfolio = await getPortfolio();
	return jsonResult(portfolio);
}
