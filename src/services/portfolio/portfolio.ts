import type { Address } from "viem";
import { loadSession } from "../auth/session.js";
import { getChainConfig, SUPPORTED_CHAINS, type ChainConfig } from "../chain/constants.js";
import { getPublicClient } from "../chain/client.js";
import { getTokens, type Token } from "../fibrous/tokens.js";
import { getBalances } from "../fibrous/balances.js";
import { formatAmount } from "../../lib/parseAmount.js";
import { AaveService } from "../defi/aave.js";
import { buildChainAssets, sumUsd, type Asset } from "./assets.js";

interface ChainPortfolio {
	chain: string;
	assets: Asset[];
	totalUsd: number;
}

interface DeFiPosition {
	protocol: string;
	chain: string;
	collateralUsd: number;
	debtUsd: number;
	healthFactor: string;
	netUsd: number;
}

export interface Portfolio {
	wallet: string;
	chains: ChainPortfolio[];
	defi: DeFiPosition[];
	totalUsd: number;
}

function getNativePrice(tokens: Record<string, Token>, chainConfig: ChainConfig): number {
	const wrapped = Object.values(tokens).find(
		(t) => t.address.toLowerCase() === chainConfig.wrappedNativeAddress.toLowerCase()
	);
	return wrapped?.price ? parseFloat(wrapped.price) : 0;
}

async function fetchChainPortfolio(
	chainConfig: ChainConfig,
	wallet: Address
): Promise<ChainPortfolio> {
	const client = getPublicClient(chainConfig);
	const tokensMap = await getTokens(chainConfig);
	const tokenList = Object.values(tokensMap);

	const [nativeBalance, tokenBalances] = await Promise.all([
		client.getBalance({ address: wallet }),
		getBalances(tokenList, wallet, chainConfig),
	]);

	const assets = buildChainAssets(
		{
			symbol: chainConfig.nativeSymbol,
			balance: formatAmount(nativeBalance, 18),
			price: getNativePrice(tokensMap, chainConfig),
		},
		tokenBalances,
		tokenList,
		chainConfig.nativeTokenAddress
	);

	return {
		chain: chainConfig.name,
		assets,
		totalUsd: sumUsd(assets),
	};
}

async function fetchAavePosition(wallet: Address): Promise<DeFiPosition | null> {
	try {
		const chainConfig = getChainConfig("base");
		const aave = new AaveService(chainConfig);
		const data = await aave.getUserAccountData(wallet);

		const collateral = parseFloat(data.totalCollateralUSD);
		const debt = parseFloat(data.totalDebtUSD);

		if (collateral === 0 && debt === 0) return null;

		return {
			protocol: "Aave V3",
			chain: "base",
			collateralUsd: collateral,
			debtUsd: debt,
			healthFactor: data.healthFactor,
			netUsd: collateral - debt,
		};
	} catch {
		return null;
	}
}

export async function getPortfolio(): Promise<Portfolio> {
	const session = loadSession();
	if (!session) {
		throw new Error("No active session. Run 'fibx auth login <email>' first.");
	}

	const wallet = session.walletAddress as Address;
	const chainNames = Object.keys(SUPPORTED_CHAINS);

	const results = await Promise.allSettled([
		...chainNames.map((name) => fetchChainPortfolio(getChainConfig(name), wallet)),
		fetchAavePosition(wallet),
	]);

	const chains: ChainPortfolio[] = [];
	const defi: DeFiPosition[] = [];

	for (let i = 0; i < chainNames.length; i++) {
		const result = results[i];
		if (result.status === "fulfilled" && result.value) {
			const portfolio = result.value as ChainPortfolio;
			if (portfolio.assets.length > 0) {
				chains.push(portfolio);
			}
		}
	}

	const aaveResult = results[chainNames.length];
	if (aaveResult.status === "fulfilled" && aaveResult.value) {
		defi.push(aaveResult.value as DeFiPosition);
	}

	chains.sort((a, b) => b.totalUsd - a.totalUsd);

	const chainTotal = chains.reduce((sum, c) => sum + c.totalUsd, 0);
	const defiTotal = defi.reduce((sum, d) => sum + d.netUsd, 0);

	return {
		wallet,
		chains,
		defi,
		totalUsd: chainTotal + defiTotal,
	};
}
