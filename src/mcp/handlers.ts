import type { Address } from "viem";
import { loadSession, requireSession } from "../services/auth/session.js";
import { getChainConfig, SUPPORTED_CHAINS } from "../services/chain/constants.js";
import { getPublicClient, getWalletClient } from "../services/chain/client.js";
import { getTokens, resolveToken } from "../services/fibrous/tokens.js";
import { getBalances } from "../services/fibrous/balances.js";
import { getRouteAndCallData, encodeSwapCalldata } from "../services/fibrous/route.js";
import {
	getAllowance,
	encodeApprove,
	encodeDeposit,
	encodeWithdraw,
	waitForAllowance,
	ERC20_ABI,
} from "../services/chain/erc20.js";
import { formatAmount, parseAmount } from "../lib/parseAmount.js";
import { validateAmount, validateAddress } from "../lib/validation.js";
import { DEFAULT_SLIPPAGE } from "../lib/config.js";
import { checkHealth } from "../services/fibrous/health.js";

export interface BalanceResult {
	wallet: string;
	chain: string;
	balances: Record<string, string>;
}

export async function handleGetBalance(chain: string): Promise<BalanceResult> {
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

	return { wallet: session.walletAddress, chain: chainConfig.name, balances };
}

export interface SwapResult {
	txHash: string;
	amountIn: string;
	amountOut: string;
	tokenIn: string;
	tokenOut: string;
	router: string;
	chain: string;
}

export async function handleSwapTokens(
	amount: string,
	fromToken: string,
	toToken: string,
	chain: string,
	slippage: number
): Promise<SwapResult> {
	validateAmount(amount);

	if (fromToken.toLowerCase() === toToken.toLowerCase()) {
		throw new Error("Source and destination tokens cannot be the same.");
	}

	const chainConfig = getChainConfig(chain);
	const session = requireSession();
	const walletClient = getWalletClient(session, chainConfig);
	const publicClient = getPublicClient(chainConfig);
	const wallet = session.walletAddress as Address;

	const [tokenIn, tokenOut] = await Promise.all([
		resolveToken(fromToken, chainConfig),
		resolveToken(toToken, chainConfig),
	]);

	const amountBaseUnits = parseAmount(amount, tokenIn.decimals);
	const isNativeInput =
		tokenIn.address.toLowerCase() === chainConfig.nativeTokenAddress.toLowerCase();
	const isNativeOutput =
		tokenOut.address.toLowerCase() === chainConfig.nativeTokenAddress.toLowerCase();
	const isWrappedInput =
		tokenIn.address.toLowerCase() === chainConfig.wrappedNativeAddress.toLowerCase();
	const isWrappedOutput =
		tokenOut.address.toLowerCase() === chainConfig.wrappedNativeAddress.toLowerCase();

	// Handle native → wrapped (wrap)
	if (isNativeInput && isWrappedOutput) {
		const data = encodeDeposit();
		const hash = await walletClient.sendTransaction({
			to: chainConfig.wrappedNativeAddress as Address,
			data,
			value: amountBaseUnits,
		});
		return {
			txHash: hash,
			amountIn: amount,
			amountOut: amount,
			tokenIn: tokenIn.symbol,
			tokenOut: tokenOut.symbol,
			router: chainConfig.wrappedNativeAddress,
			chain: chainConfig.name,
		};
	}

	// Handle wrapped → native (unwrap)
	if (isWrappedInput && isNativeOutput) {
		const data = encodeWithdraw(amountBaseUnits);
		const hash = await walletClient.sendTransaction({
			to: chainConfig.wrappedNativeAddress as Address,
			data,
			value: 0n,
		});
		return {
			txHash: hash,
			amountIn: amount,
			amountOut: amount,
			tokenIn: tokenIn.symbol,
			tokenOut: tokenOut.symbol,
			router: chainConfig.wrappedNativeAddress,
			chain: chainConfig.name,
		};
	}

	const routeData = await getRouteAndCallData(
		{
			amount: amountBaseUnits.toString(),
			tokenInAddress: tokenIn.address,
			tokenOutAddress: tokenOut.address,
			slippage: slippage ?? DEFAULT_SLIPPAGE,
			destination: wallet,
		},
		chainConfig
	);

	const routerAddress = routeData.router_address as Address;

	// ERC-20 approval
	if (!isNativeInput) {
		const currentAllowance = await getAllowance(
			publicClient,
			tokenIn.address as Address,
			wallet,
			routerAddress
		);

		if (currentAllowance < amountBaseUnits) {
			const approveData = encodeApprove(routerAddress, amountBaseUnits);
			const approveTxHash = await walletClient.sendTransaction({
				to: tokenIn.address as Address,
				data: approveData,
				value: 0n,
			});

			await publicClient.waitForTransactionReceipt({
				hash: approveTxHash,
				confirmations: 1,
			});

			// Wait for on-chain allowance update
			await waitForAllowance(
				publicClient,
				tokenIn.address as Address,
				wallet,
				routerAddress,
				amountBaseUnits
			);
		}
	}

	// Simulate & execute swap
	const swapData = encodeSwapCalldata(routeData.calldata, chainConfig);
	const value = isNativeInput ? amountBaseUnits : 0n;

	await publicClient.estimateGas({
		account: wallet,
		to: routerAddress,
		data: swapData,
		value,
	});

	const hash = await walletClient.sendTransaction({
		to: routerAddress,
		data: swapData,
		value,
	});

	const outputAmount = formatAmount(BigInt(routeData.route.outputAmount), tokenOut.decimals);

	return {
		txHash: hash,
		amountIn: amount,
		amountOut: outputAmount,
		tokenIn: tokenIn.symbol,
		tokenOut: tokenOut.symbol,
		router: routerAddress,
		chain: chainConfig.name,
	};
}

export interface SendResult {
	txHash: string;
	amount: string;
	token: string;
	recipient: string;
	chain: string;
}

export async function handleSendTokens(
	amount: string,
	recipient: string,
	token: string | undefined,
	chain: string
): Promise<SendResult> {
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

		await publicClient.estimateGas({
			account: wallet,
			to,
			value: amountBaseUnits,
			data: undefined,
		});

		const hash = await walletClient.sendTransaction({
			to,
			value: amountBaseUnits,
			data: undefined,
		});

		return {
			txHash: hash,
			amount,
			token: resolvedSymbol,
			recipient,
			chain: chainConfig.name,
		};
	}

	// ERC-20 transfer
	const resolved = await resolveToken(token!, chainConfig);
	const amountBaseUnits = parseAmount(amount, resolved.decimals);

	const { request } = await publicClient.simulateContract({
		address: resolved.address as Address,
		abi: ERC20_ABI,
		functionName: "transfer",
		args: [to, amountBaseUnits],
		account: wallet,
	});

	const hash = await walletClient.writeContract(request);

	return {
		txHash: hash,
		amount,
		token: resolved.symbol,
		recipient,
		chain: chainConfig.name,
	};
}

export interface TxStatusResult {
	hash: string;
	status: string;
	blockNumber: string | null;
	from: string;
	to: string | null;
	gasUsed: string | null;
	chain: string;
}

export async function handleGetTxStatus(hash: string, chain: string): Promise<TxStatusResult> {
	const chainConfig = getChainConfig(chain);
	const client = getPublicClient(chainConfig);

	const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });

	return {
		hash,
		status: receipt.status === "success" ? "confirmed" : "reverted",
		blockNumber: receipt.blockNumber.toString(),
		from: receipt.from,
		to: receipt.to ?? null,
		gasUsed: receipt.gasUsed.toString(),
		chain: chainConfig.name,
	};
}

export interface AaveStatusResult {
	wallet: string;
	healthFactor: string;
	totalCollateralUSD: string;
	totalDebtUSD: string;
	availableBorrowsUSD: string;
}

export async function handleGetAaveStatus(): Promise<AaveStatusResult> {
	const session = loadSession();
	if (!session) {
		throw new Error("No active session. Run 'fibx auth login <email>' first.");
	}

	const chainConfig = getChainConfig("base");
	const { AaveService } = await import("../services/defi/aave.js");
	const aave = new AaveService(chainConfig);

	try {
		const walletClient = getWalletClient(session, chainConfig);
		aave.setWalletClient(walletClient);
	} catch {
		// Read-only mode
	}

	const userAddress = session.walletAddress as Address;
	const data = await aave.getUserAccountData(userAddress);

	return {
		wallet: session.walletAddress,
		healthFactor: data.healthFactor,
		totalCollateralUSD: data.totalCollateralUSD,
		totalDebtUSD: data.totalDebtUSD,
		availableBorrowsUSD: data.availableBorrowsUSD,
	};
}

export interface AaveActionResult {
	action: string;
	amount: string;
	token: string;
	txHash: string;
	chain: string;
}

export async function handleAaveAction(
	action: "supply" | "borrow" | "repay" | "withdraw",
	amount: string,
	tokenSymbol: string
): Promise<AaveActionResult> {
	const session = requireSession();
	const chainConfig = getChainConfig("base");

	// Normalize "max" to "-1" (Aave service convention)
	const isMax = amount.toLowerCase() === "max" || amount === "-1";
	const normalizedAmount = isMax ? "-1" : amount;

	if (!isMax) {
		validateAmount(normalizedAmount);
	}

	const { AaveService } = await import("../services/defi/aave.js");
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

	return {
		action,
		amount: isMax ? "MAX" : amount,
		token: isNativeETH ? `${chainConfig.nativeSymbol} (auto-wrapped)` : token.symbol,
		txHash,
		chain: "base",
	};
}

export interface AuthStatusResult {
	authenticated: boolean;
	walletAddress: string | null;
	sessionType: string | null;
	chain: string;
	fibrousStatus: string;
}

export async function handleGetAuthStatus(chain: string): Promise<AuthStatusResult> {
	const session = loadSession();
	const chainConfig = getChainConfig(chain);

	let fibrousStatus = "unreachable";
	try {
		const health = await checkHealth(chainConfig);
		fibrousStatus = health.message;
	} catch {
		fibrousStatus = "unreachable";
	}

	if (!session) {
		return {
			authenticated: false,
			walletAddress: null,
			sessionType: null,
			chain: chainConfig.name,
			fibrousStatus,
		};
	}

	return {
		authenticated: true,
		walletAddress: session.walletAddress,
		sessionType: session.type,
		chain: chainConfig.name,
		fibrousStatus,
	};
}

export interface ConfigResult {
	action: string;
	chain?: string;
	url?: string;
	rpcUrls?: Record<string, string>;
}

export async function handleConfigAction(
	action: "set-rpc" | "get-rpc" | "reset-rpc" | "list",
	chain?: string,
	url?: string
): Promise<ConfigResult> {
	const { configService } = await import("../services/config/config.js");

	if (action === "list") {
		const config = configService.getConfig();
		return { action, rpcUrls: config.rpcUrls };
	}

	if (action === "reset-rpc") {
		if (chain) {
			if (!SUPPORTED_CHAINS[chain]) {
				throw new Error(
					`Unsupported chain: ${chain}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`
				);
			}
			configService.resetRpcUrl(chain);
			return { action, chain, url: SUPPORTED_CHAINS[chain]?.rpcUrl };
		}
		configService.resetAll();
		return { action, rpcUrls: {} };
	}

	if (!chain) throw new Error("Chain is required for this action.");
	if (!SUPPORTED_CHAINS[chain]) {
		throw new Error(
			`Unsupported chain: ${chain}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`
		);
	}

	if (action === "get-rpc") {
		const customUrl = configService.getRpcUrl(chain);
		const defaultUrl = SUPPORTED_CHAINS[chain]?.rpcUrl;
		return { action, chain, url: customUrl || defaultUrl };
	}

	if (!url) throw new Error("URL is required for set-rpc.");
	try {
		new URL(url);
	} catch {
		throw new Error("Invalid URL format.");
	}

	configService.setRpcUrl(chain, url);
	return { action, chain, url };
}
