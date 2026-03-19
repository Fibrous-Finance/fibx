import {
	createPublicClient,
	http,
	parseUnits,
	formatUnits,
	maxUint256,
	type Address,
	type Hash,
	type Account,
	type PublicClient,
	type WalletClient,
	erc20Abi,
} from "viem";
import { type ChainConfig } from "../chain/constants.js";
import {
	POOL_ADDRESSES_PROVIDER_ABI,
	POOL_ABI,
	POOL_DATA_PROVIDER_ABI,
	WETH_ABI,
} from "./abi/aave.js";
import {
	AAVE_V3_POOL_ADDRESSES_PROVIDER,
	AAVE_V3_POOL_DATA_PROVIDER,
	InterestRateMode,
} from "./constants.js";
import { NonceManager } from "../chain/nonceManager.js";
import { waitForAllowance } from "../chain/erc20.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

export interface UserAccountData {
	totalCollateralUSD: string;
	totalDebtUSD: string;
	availableBorrowsUSD: string;
	currentLiquidationThreshold: string;
	ltv: string;
	healthFactor: string;
}

export interface AaveMarket {
	symbol: string;
	address: string;
	supplyAPY: string;
	borrowAPY: string;
	totalSupply: string;
	totalBorrow: string;
	ltv: string;
	isActive: boolean;
	isFrozen: boolean;
}

type DataProviderReserveData = readonly [
	bigint, // currentATokenBalance
	bigint, // currentStableDebt
	bigint, // currentVariableDebt
	bigint, // principalStableDebt
	bigint, // scaledVariableDebt
	bigint, // stableBorrowRate
	bigint, // liquidityRate
	number, // stableRateLastUpdated
	boolean, // usageAsCollateralEnabled
];

export class AaveService {
	private publicClient: PublicClient;
	private walletClient?: WalletClient;
	private account?: Account;
	private userAddress?: Address;

	private chainConfig: ChainConfig;

	constructor(chainConfig: ChainConfig, walletClient?: WalletClient) {
		this.chainConfig = chainConfig;
		this.publicClient = createPublicClient({
			chain: chainConfig.viemChain,
			transport: http(chainConfig.rpcUrl),
		}) as PublicClient;

		if (walletClient) {
			this.setWalletClient(walletClient);
		}
	}

	public getAccountAddress(): Address | undefined {
		return this.userAddress;
	}

	public setAccountAddress(address: Address) {
		this.userAddress = address;
	}

	public setWalletClient(walletClient: WalletClient) {
		this.walletClient = walletClient;
		if (walletClient.account) {
			this.account = walletClient.account;
			this.userAddress = walletClient.account.address;
		}
	}

	private async getPoolAddress(): Promise<Address> {
		return (await this.publicClient.readContract({
			address: AAVE_V3_POOL_ADDRESSES_PROVIDER,
			abi: POOL_ADDRESSES_PROVIDER_ABI,
			functionName: "getPool",
		})) as Address;
	}

	public async getUserAccountData(userAddress: Address): Promise<UserAccountData> {
		const poolAddress = await this.getPoolAddress();
		const data = await this.publicClient.readContract({
			address: poolAddress,
			abi: POOL_ABI,
			functionName: "getUserAccountData",
			args: [userAddress],
		});

		// Values in Base Currency (USD, 8 decimals)
		return {
			totalCollateralUSD: formatUnits(data[0], 8),
			totalDebtUSD: formatUnits(data[1], 8),
			availableBorrowsUSD: formatUnits(data[2], 8),
			currentLiquidationThreshold: formatUnits(data[3], 4),
			ltv: formatUnits(data[4], 4),
			healthFactor: formatUnits(data[5], 18),
		};
	}

	public async getMarkets(): Promise<AaveMarket[]> {
		// 1. Get all reserve tokens with symbols
		const reserveTokens = (await this.publicClient.readContract({
			address: AAVE_V3_POOL_DATA_PROVIDER,
			abi: POOL_DATA_PROVIDER_ABI,
			functionName: "getAllReservesTokens",
		})) as readonly { symbol: string; tokenAddress: Address }[];

		// 2. Build multicall contracts array — 2 calls per token (reserveData + configData)
		const contracts = reserveTokens.flatMap((token) => [
			{
				address: AAVE_V3_POOL_DATA_PROVIDER,
				abi: POOL_DATA_PROVIDER_ABI,
				functionName: "getReserveData" as const,
				args: [token.tokenAddress] as const,
			},
			{
				address: AAVE_V3_POOL_DATA_PROVIDER,
				abi: POOL_DATA_PROVIDER_ABI,
				functionName: "getReserveConfigurationData" as const,
				args: [token.tokenAddress] as const,
			},
		]);

		// 3. Single batched RPC call — avoids rate limiting
		const results = await this.publicClient.multicall({ contracts });

		// 4. Parse results in pairs
		const markets: AaveMarket[] = [];
		for (let i = 0; i < reserveTokens.length; i++) {
			const token = reserveTokens[i];
			const reserveResult = results[i * 2];
			const configResult = results[i * 2 + 1];

			if (
				!token ||
				reserveResult?.status !== "success" ||
				configResult?.status !== "success"
			) {
				continue;
			}

			const rd = reserveResult.result as readonly [
				bigint,
				bigint,
				bigint,
				bigint,
				bigint,
				bigint,
				bigint,
				bigint,
				bigint,
				bigint,
				bigint,
				number,
			];
			const cd = configResult.result as readonly [
				bigint,
				bigint,
				bigint,
				bigint,
				bigint,
				boolean,
				boolean,
				boolean,
				boolean,
				boolean,
			];

			const decimals = Number(cd[0]);
			const isActive = cd[8];
			const isFrozen = cd[9];

			if (!isActive) continue;

			// APY from RAY (1e27): rate / 1e27 * 100
			const RAY = 10n ** 27n;
			const supplyRate = rd[5]; // liquidityRate
			const borrowRate = rd[6]; // variableBorrowRate

			const supplyAPY = Number((supplyRate * 10000n) / RAY) / 100;
			const borrowAPY = Number((borrowRate * 10000n) / RAY) / 100;

			const totalAToken = rd[2]; // totalSupply (in token decimals)
			const totalVariableDebt = rd[4]; // totalBorrow

			const ltvBps = Number(cd[1]);

			markets.push({
				symbol: token.symbol,
				address: token.tokenAddress,
				supplyAPY: `${supplyAPY.toFixed(2)}%`,
				borrowAPY: `${borrowAPY.toFixed(2)}%`,
				totalSupply: formatUnits(totalAToken, decimals),
				totalBorrow: formatUnits(totalVariableDebt, decimals),
				ltv: `${(ltvBps / 100).toFixed(1)}%`,
				isActive,
				isFrozen,
			});
		}

		return markets;
	}

	public async supply(tokenAddress: Address, amountStr: string): Promise<Hash> {
		await this.ensureWalletConnection();

		const poolAddress = await this.getPoolAddress();
		const decimals = await this.getTokenDecimals(tokenAddress);
		const amount = parseUnits(amountStr, decimals);

		const allowance = await this.publicClient.readContract({
			address: tokenAddress,
			abi: erc20Abi,
			functionName: "allowance",
			args: [this.account!.address, poolAddress],
		});

		if (allowance < amount) {
			const nonceApprove = await NonceManager.getInstance().getNextNonce();
			const txApprove = await this.walletClient!.writeContract({
				address: tokenAddress,
				abi: erc20Abi,
				functionName: "approve",
				args: [poolAddress, amount],
				chain: this.chainConfig.viemChain,
				account: this.account!,
				nonce: nonceApprove,
			});
			await this.publicClient.waitForTransactionReceipt({ hash: txApprove });
			await waitForAllowance(
				this.publicClient,
				tokenAddress,
				this.account!.address,
				poolAddress,
				amount
			);
		}

		const { request: supplyRequest } = await this.publicClient.simulateContract({
			address: poolAddress,
			abi: POOL_ABI,
			functionName: "supply",
			args: [tokenAddress, amount, this.account!.address, 0],
			account: this.account!,
			chain: this.chainConfig.viemChain,
		});

		const nonceSupply = await NonceManager.getInstance().getNextNonce();
		const txSupply = await this.walletClient!.writeContract({
			...supplyRequest,
			nonce: nonceSupply,
		});

		await this.publicClient.waitForTransactionReceipt({ hash: txSupply });
		return txSupply;
	}

	public async wrapETH(amountStr: string): Promise<Hash> {
		await this.ensureWalletConnection();

		const amount = parseUnits(amountStr, 18);

		const { request } = await this.publicClient.simulateContract({
			address: this.chainConfig.wrappedNativeAddress as Address,
			abi: WETH_ABI,
			functionName: "deposit",
			args: [],
			value: amount,
			account: this.account!,
			chain: this.chainConfig.viemChain,
		});

		const nonce = await NonceManager.getInstance().getNextNonce();

		const txWrap = await this.walletClient!.writeContract({
			...request,
			nonce,
		});

		await this.publicClient.waitForTransactionReceipt({ hash: txWrap });
		return txWrap;
	}

	public async unwrapWETH(amountStr: string): Promise<Hash> {
		await this.ensureWalletConnection();

		const amount = parseUnits(amountStr, 18);

		const { request } = await this.publicClient.simulateContract({
			address: this.chainConfig.wrappedNativeAddress as Address,
			abi: WETH_ABI,
			functionName: "withdraw",
			args: [amount],
			account: this.account!,
			chain: this.chainConfig.viemChain,
		});

		const nonce = await NonceManager.getInstance().getNextNonce();

		const txUnwrap = await this.walletClient!.writeContract({
			...request,
			nonce,
		});

		await this.publicClient.waitForTransactionReceipt({ hash: txUnwrap });
		return txUnwrap;
	}

	public async withdraw(tokenAddress: Address, amountStr: string): Promise<Hash> {
		await this.ensureWalletConnection();

		const poolAddress = await this.getPoolAddress();
		const userAddress = this.account!.address;
		let amount: bigint;

		if (amountStr.toLowerCase() === "max" || amountStr === "-1") {
			amount = maxUint256;
		} else {
			const decimals = await this.getTokenDecimals(tokenAddress);
			amount = parseUnits(amountStr, decimals);
		}

		let request;
		try {
			const result = await this.publicClient.simulateContract({
				address: poolAddress,
				abi: POOL_ABI,
				functionName: "withdraw",
				args: [tokenAddress, amount, userAddress],
				account: this.account!,
				chain: this.chainConfig.viemChain,
			});
			request = result.request;
		} catch (error: unknown) {
			await this.handleLiquidationError(error, userAddress);
			throw error; // detailed error thrown by handleLiquidationError, but needed for TS control flow
		}

		const nonce = await NonceManager.getInstance().getNextNonce();

		const txWithdraw = await this.walletClient!.writeContract({
			...request,
			nonce,
		});

		await this.publicClient.waitForTransactionReceipt({ hash: txWithdraw });
		return txWithdraw;
	}

	public async borrow(tokenAddress: Address, amountStr: string): Promise<Hash> {
		await this.ensureWalletConnection();

		const poolAddress = await this.getPoolAddress();
		const decimals = await this.getTokenDecimals(tokenAddress);
		const amount = parseUnits(amountStr, decimals);

		let request;
		try {
			const result = await this.publicClient.simulateContract({
				address: poolAddress,
				abi: POOL_ABI,
				functionName: "borrow",
				args: [
					tokenAddress,
					amount,
					BigInt(InterestRateMode.Variable),
					0,
					this.account!.address,
				],
				chain: this.chainConfig.viemChain,
				account: this.account!,
			});
			request = result.request;
		} catch (error: unknown) {
			const err = error as Error & { cause?: { message?: string } };
			if (
				err.message?.includes("HealthFactorLowerThanLiquidationThreshold") ||
				err.cause?.message?.includes("0x6679996d")
			) {
				throw new FibxError(
					ErrorCode.WALLET_ERROR,
					"Cannot borrow: This amount would lower your Health Factor below 1.0 (Liquidation Threshold). Try borrowing a smaller amount or adding more collateral first."
				);
			}
			throw error;
		}

		const nonce = await NonceManager.getInstance().getNextNonce();

		const txBorrow = await this.walletClient!.writeContract({
			...request,
			nonce,
		});

		await this.publicClient.waitForTransactionReceipt({ hash: txBorrow });
		return txBorrow;
	}

	public async repay(tokenAddress: Address, amountStr: string): Promise<Hash> {
		await this.ensureWalletConnection();

		const poolAddress = await this.getPoolAddress();
		let amount: bigint;

		if (amountStr.toLowerCase() === "max" || amountStr === "-1") {
			amount = maxUint256;
		} else {
			const decimals = await this.getTokenDecimals(tokenAddress);
			amount = parseUnits(amountStr, decimals);
		}

		const allowance = await this.publicClient.readContract({
			address: tokenAddress,
			abi: erc20Abi,
			functionName: "allowance",
			args: [this.account!.address, poolAddress],
		});

		if (allowance < amount) {
			const nonceApprove = await NonceManager.getInstance().getNextNonce();
			const txApprove = await this.walletClient!.writeContract({
				address: tokenAddress,
				abi: erc20Abi,
				functionName: "approve",
				args: [poolAddress, amount],
				chain: this.chainConfig.viemChain,
				account: this.account!,
				nonce: nonceApprove,
			});
			await this.publicClient.waitForTransactionReceipt({ hash: txApprove });
			await waitForAllowance(
				this.publicClient,
				tokenAddress,
				this.account!.address,
				poolAddress,
				amount
			);
		}

		try {
			const { request: repayRequest } = await this.publicClient.simulateContract({
				address: poolAddress,
				abi: POOL_ABI,
				functionName: "repay",
				args: [
					tokenAddress,
					amount,
					BigInt(InterestRateMode.Variable),
					this.account!.address,
				],
				account: this.account!,
				chain: this.chainConfig.viemChain,
			});

			const nonceRepay = await NonceManager.getInstance().getNextNonce();

			const txRepay = await this.walletClient!.writeContract({
				...repayRequest,
				nonce: nonceRepay,
			});

			await this.publicClient.waitForTransactionReceipt({ hash: txRepay });
			return txRepay;
		} catch (error: unknown) {
			const err = error as Error & { cause?: { message?: string } };
			// NoDebtOfSelectedType (0xf0788fb2) = already debt-free
			if (
				err.message?.includes("NoDebtOfSelectedType") ||
				err.cause?.message?.includes("0xf0788fb2")
			) {
				return "0x0" as Hash;
			}
			throw error;
		}
	}

	private async ensureWalletConnection() {
		if (!this.walletClient || !this.account) {
			throw new FibxError(
				ErrorCode.WALLET_ERROR,
				"Wallet not connected. Please login or provide a PRIVATE_KEY."
			);
		}
		await NonceManager.getInstance().init(this.account.address, this.publicClient);
	}

	private async getTokenDecimals(tokenAddress: Address): Promise<number> {
		return await this.publicClient.readContract({
			address: tokenAddress,
			abi: erc20Abi,
			functionName: "decimals",
		});
	}

	// Repay with auto ETH wrapping if needed.
	public async repayWithAutoWrap(
		tokenAddress: Address,
		amountStr: string,
		onStatus?: (status: string) => void
	): Promise<Hash> {
		await this.ensureWalletConnection();

		if (onStatus) onStatus("Checking debt...");
		const currentDebt = await this.getAssetDebt(tokenAddress);

		if (currentDebt === 0n) {
			throw new FibxError(ErrorCode.VALIDATION_ERROR, "No debt found for this asset.");
		}

		let amountToRepay: bigint;
		let finalAmountStr = amountStr;

		const decimals = await this.getTokenDecimals(tokenAddress);

		if (amountStr === "-1" || amountStr.toLowerCase() === "max") {
			// 0.1% buffer for accrued interest
			const interestBuffer = currentDebt / 1000n;
			const safeMax = currentDebt + interestBuffer;
			amountToRepay = safeMax;
			finalAmountStr = "-1"; // Protocol indication for "repay all"
		} else {
			amountToRepay = parseUnits(amountStr, decimals);
			if (amountToRepay > currentDebt) {
				amountToRepay = currentDebt;
				finalAmountStr = "-1";
			}
		}

		const isWrappedNative =
			tokenAddress.toLowerCase() === this.chainConfig.wrappedNativeAddress.toLowerCase();

		if (isWrappedNative) {
			if (onStatus) onStatus("Checking WETH balance for auto-wrap...");

			const wethBalance = await this.publicClient.readContract({
				address: tokenAddress,
				abi: erc20Abi,
				functionName: "balanceOf",
				args: [this.account!.address],
			});

			if (wethBalance < amountToRepay) {
				const ethBalance = await this.publicClient.getBalance({
					address: this.account!.address,
				});
				const needed = amountToRepay - wethBalance;

				if (ethBalance >= needed) {
					if (onStatus) onStatus(`Wrapping ${formatUnits(needed, 18)} ETH to WETH...`);
					await this.wrapETH(formatUnits(needed, 18));
				} else {
					throw new FibxError(
						ErrorCode.VALIDATION_ERROR,
						`Insufficient WETH+ETH balance. Available: ${formatUnits(
							wethBalance + ethBalance,
							18
						)}`
					);
				}
			}
		}

		if (onStatus) onStatus("Signaling Aave Repay...");

		if (finalAmountStr === "-1") {
			const interestBuffer = currentDebt / 1000n;
			const safeMax = currentDebt + interestBuffer;
			finalAmountStr = formatUnits(safeMax, decimals);
		}

		return await this.repay(tokenAddress, finalAmountStr);
	}

	public async getAssetDebt(tokenAddress: Address): Promise<bigint> {
		const poolDataProvider = AAVE_V3_POOL_DATA_PROVIDER;
		const data = await this.publicClient.readContract({
			address: poolDataProvider,
			abi: POOL_DATA_PROVIDER_ABI,
			functionName: "getUserReserveData",
			args: [tokenAddress, this.account!.address],
		});

		const stableDebt = data[1];
		const variableDebt = data[2];

		return stableDebt + variableDebt;
	}

	// Supply with auto ETH wrapping if needed.
	public async supplyWithAutoWrap(
		tokenAddress: Address,
		amountStr: string,
		onStatus?: (status: string) => void
	): Promise<Hash> {
		await this.ensureWalletConnection();

		const decimals = await this.getTokenDecimals(tokenAddress);
		const amount = parseUnits(amountStr, decimals);

		if (onStatus) onStatus("Checking balance...");

		const tokenBalance = await this.publicClient.readContract({
			address: tokenAddress,
			abi: erc20Abi,
			functionName: "balanceOf",
			args: [this.account!.address],
		});

		const isWrappedNative =
			tokenAddress.toLowerCase() === this.chainConfig.wrappedNativeAddress.toLowerCase();

		if (isWrappedNative) {
			const ethBalance = await this.publicClient.getBalance({
				address: this.account!.address,
			});

			if (tokenBalance < amount) {
				const needed = amount - tokenBalance;
				if (ethBalance >= needed) {
					if (onStatus) onStatus(`Wrapping ${formatUnits(needed, 18)} ETH to WETH...`);
					await this.wrapETH(formatUnits(needed, 18));
				} else {
					throw new FibxError(
						ErrorCode.VALIDATION_ERROR,
						`Insufficient WETH+ETH balance. Available: ${formatUnits(
							tokenBalance + ethBalance,
							18
						)}`
					);
				}
			}
		} else {
			if (tokenBalance < amount) {
				throw new FibxError(
					ErrorCode.VALIDATION_ERROR,
					`Insufficient balance. Available: ${formatUnits(tokenBalance, decimals)}`
				);
			}
		}

		if (onStatus) onStatus("Signaling Aave Supply...");
		return await this.supply(tokenAddress, amountStr);
	}

	// Withdraw with optional WETH → ETH unwrapping.
	public async withdrawWithAutoUnwrap(
		tokenAddress: Address,
		amountStr: string,
		unwrapToNative: boolean = false,
		onStatus?: (status: string) => void
	): Promise<Hash> {
		if (onStatus) onStatus("Signaling Aave Withdraw...");
		const tx = await this.withdraw(tokenAddress, amountStr);

		if (unwrapToNative) {
			const isWrappedNative =
				tokenAddress.toLowerCase() === this.chainConfig.wrappedNativeAddress.toLowerCase();

			if (isWrappedNative) {
				if (onStatus) onStatus("Unwrapping WETH to ETH...");

				let amountToUnwrap = amountStr;

				if (amountStr === "-1" || amountStr.toLowerCase() === "max") {
					const balance = await this.publicClient.readContract({
						address: tokenAddress,
						abi: erc20Abi,
						functionName: "balanceOf",
						args: [this.account!.address],
					});
					amountToUnwrap = formatUnits(balance, 18);
				}

				await this.unwrapWETH(amountToUnwrap);
				if (onStatus) onStatus("Unwrapped WETH successfully");
			}
		}

		return tx;
	}

	private async getDebts(
		dataProviderAddress: Address,
		reserves: readonly Address[]
	): Promise<string[]> {
		const debtDetails: string[] = [];

		// Multicall: batch fetch all reserve data
		const reserveDataCalls = reserves.map((asset) => ({
			address: dataProviderAddress,
			abi: POOL_DATA_PROVIDER_ABI,
			functionName: "getUserReserveData",
			args: [asset, this.account!.address],
		}));

		const results = await this.publicClient.multicall({
			contracts: reserveDataCalls,
			allowFailure: true,
		});

		const assetsWithDebt: Address[] = [];
		const debts: bigint[] = [];

		results.forEach((result, index) => {
			if (result.status === "success" && result.result) {
				const data = result.result as unknown as DataProviderReserveData;
				const stableDebt = data[1];
				const variableDebt = data[2];

				if (stableDebt > 0n || variableDebt > 0n) {
					assetsWithDebt.push(reserves[index]);
					debts.push(stableDebt + variableDebt);
				}
			}
		});

		if (assetsWithDebt.length > 0) {
			type ContractCall = {
				address: Address;
				abi: typeof erc20Abi;
				functionName: "symbol" | "decimals";
			};
			const detailCalls: ContractCall[] = [];

			assetsWithDebt.forEach((asset) => {
				detailCalls.push({
					address: asset,
					abi: erc20Abi,
					functionName: "symbol",
				});
				detailCalls.push({
					address: asset,
					abi: erc20Abi,
					functionName: "decimals",
				});
			});

			try {
				const detailResults = await this.publicClient.multicall({
					contracts: detailCalls,
					allowFailure: false,
				});

				for (let i = 0; i < assetsWithDebt.length; i++) {
					const symbol = detailResults[i * 2] as string;
					const decimals = detailResults[i * 2 + 1] as number;
					const debt = debts[i];
					debtDetails.push(`${symbol}: $${formatUnits(debt, decimals)}`);
				}
			} catch (error) {
				console.warn("Failed to fetch debt token details via multicall:", error);
				// Fallback: list addresses with raw amounts
				assetsWithDebt.forEach((asset, i) => {
					debtDetails.push(`${asset}: raw units ${debts[i]}`);
				});
			}
		}

		return debtDetails;
	}

	private async handleLiquidationError(error: unknown, userAddress: Address): Promise<never> {
		const err = error as Error & { cause?: { message?: string } };
		const userData = await this.getUserAccountData(userAddress);
		const totalDebt = parseFloat(userData.totalDebtUSD);

		if (
			err.message?.includes("HealthFactorLowerThanLiquidationThreshold") ||
			err.cause?.message?.includes("0x6679996d")
		) {
			let details = "This amount would lower your Health Factor below 1.0.";

			// Check cross-asset dust debt
			if (totalDebt > 0) {
				try {
					const poolContract = {
						address: await this.getPoolAddress(),
						abi: POOL_ABI,
					} as const;

					const reserves = await this.publicClient.readContract({
						...poolContract,
						functionName: "getReservesList",
					});

					const debts = await this.getDebts(
						AAVE_V3_POOL_DATA_PROVIDER,
						reserves as unknown as readonly Address[]
					);

					if (debts.length > 0) {
						details = `You have remaining debt in other assets: ${debts.join(
							", "
						)}. You must repay these debts first to withdraw max collateral.`;
					} else if (totalDebt < 0.01) {
						details = `You have tiny "dust" debt ($${totalDebt.toFixed(
							6
						)}) in an asset (scan failed to identify) preventing full withdrawal.`;
					}
				} catch (error) {
					console.error("Error scanning debts:", error);
					// Fallback
					if (totalDebt < 0.01) {
						details = `You have tiny "dust" debt ($${totalDebt.toFixed(
							6
						)}) in an asset preventing full withdrawal.`;
					}
				}
			}

			const totalCollateral = parseFloat(userData.totalCollateralUSD);
			const lt = parseFloat(userData.currentLiquidationThreshold) / 10000;
			if (lt > 0) {
				const requiredCollateral = totalDebt / lt;
				const maxSafeUSD = Math.max(0, totalCollateral - requiredCollateral);
				if (maxSafeUSD < totalCollateral) {
					details += ` You need keep ~$${requiredCollateral.toFixed(2)} collateral to cover your debt. Max safe withdraw is approx $${maxSafeUSD.toFixed(2)}.`;
				}
			}

			throw new FibxError(ErrorCode.WALLET_ERROR, `Cannot withdraw: ${details}`);
		}
		throw error;
	}
}
