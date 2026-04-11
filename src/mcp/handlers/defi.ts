import type { Address } from "viem";
import { loadSession, requireSession } from "../../services/auth/session.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { getWalletClient } from "../../services/chain/client.js";
import { resolveToken } from "../../services/fibrous/tokens.js";
import { validateAmount } from "../../lib/validation.js";
import { jsonResult } from "./utils.js";

export async function handleGetAaveStatus() {
	const session = loadSession();
	if (!session) {
		throw new Error("No active session. Run 'fibx auth login <email>' first.");
	}

	const chainConfig = getChainConfig("base");
	const { AaveService } = await import("../../services/defi/aave.js");
	const aave = new AaveService(chainConfig);

	try {
		const walletClient = getWalletClient(session, chainConfig);
		aave.setWalletClient(walletClient);
	} catch {
		// Read-only
	}

	const userAddress = session.walletAddress as Address;
	const data = await aave.getUserAccountData(userAddress);

	return jsonResult({
		wallet: session.walletAddress,
		healthFactor: data.healthFactor,
		totalCollateralUSD: data.totalCollateralUSD,
		totalDebtUSD: data.totalDebtUSD,
		availableBorrowsUSD: data.availableBorrowsUSD,
	});
}

export async function handleGetAaveMarkets() {
	const chainConfig = getChainConfig("base");
	const { AaveService } = await import("../../services/defi/aave.js");
	const aave = new AaveService(chainConfig);

	const markets = await aave.getMarkets();

	return jsonResult({
		chain: "base",
		marketCount: markets.length,
		markets: markets.map((m) => ({
			symbol: m.symbol,
			supplyAPY: m.supplyAPY,
			borrowAPY: m.borrowAPY,
			totalSupply: m.totalSupply,
			totalBorrow: m.totalBorrow,
			ltv: m.ltv,
			isFrozen: m.isFrozen,
		})),
	});
}

export async function handleAaveAction({
	action,
	amount,
	token: tokenSymbol,
	simulate,
}: {
	action: "supply" | "borrow" | "repay" | "withdraw";
	amount: string;
	token: string;
	simulate?: boolean;
}) {
	const session = requireSession();
	const chainConfig = getChainConfig("base");

	// "max" → "-1" (Aave convention)
	const isMax = amount.toLowerCase() === "max" || amount === "-1";
	const normalizedAmount = isMax ? "-1" : amount;

	if (!isMax) {
		validateAmount(normalizedAmount);
	}

	const { AaveService } = await import("../../services/defi/aave.js");
	const aave = new AaveService(chainConfig);

	const walletClient = getWalletClient(session, chainConfig);
	aave.setWalletClient(walletClient);

	let token = await resolveToken(tokenSymbol, chainConfig);
	const isNativeETH = tokenSymbol.toUpperCase() === chainConfig.nativeSymbol;

	if (token.address === chainConfig.nativeTokenAddress) {
		token = {
			...token,
			address: chainConfig.wrappedNativeAddress as Address,
			symbol: "WETH",
			name: "Wrapped Ether",
		};
	}

	if (simulate) {
		return jsonResult({
			success: true,
			mode: "SIMULATION (no TX sent)",
			action,
			amount: isMax ? "MAX" : amount,
			token: isNativeETH ? `${chainConfig.nativeSymbol} (auto-wrapped)` : token.symbol,
			chain: "base",
		});
	}

	let txHash: string;

	switch (action) {
		case "supply":
			txHash = await aave.supplyWithAutoWrap(
				token.address as Address,
				normalizedAmount,
				() => {}
			);
			break;
		case "borrow":
			txHash = await aave.borrow(token.address as Address, normalizedAmount);
			break;
		case "repay":
			txHash = await aave.repayWithAutoWrap(
				token.address as Address,
				normalizedAmount,
				() => {}
			);
			break;
		case "withdraw":
			txHash = await aave.withdrawWithAutoUnwrap(
				token.address as Address,
				normalizedAmount,
				isNativeETH,
				() => {}
			);
			break;
	}

	const explorer = chainConfig.viemChain.blockExplorers?.default.url
		? `${chainConfig.viemChain.blockExplorers.default.url}/tx/${txHash}`
		: undefined;
	return jsonResult({
		action,
		amount: isMax ? "MAX" : amount,
		token: isNativeETH ? `${chainConfig.nativeSymbol} (auto-wrapped)` : token.symbol,
		txHash,
		chain: "base",
		explorer,
	});
}
