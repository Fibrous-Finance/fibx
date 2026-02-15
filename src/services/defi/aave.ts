import {
	createPublicClient,
	http,
	parseUnits,
	formatUnits,
	type Address,
	type Hash,
	type Account,
	type PublicClient,
	type WalletClient,
	erc20Abi,
} from "viem";
import { base } from "viem/chains";
import { RPC_URLS } from "../chain/constants.js";
import { POOL_ADDRESSES_PROVIDER_ABI, POOL_ABI, WETH_ABI } from "./abi/aave.js";
import {
	AAVE_V3_POOL_ADDRESSES_PROVIDER,
	InterestRateMode,
	WETH_BASE_ADDRESS,
} from "./constants.js";
import { NonceManager } from "../chain/nonceManager.js";

export interface UserAccountData {
	totalCollateralUSD: string;
	totalDebtUSD: string;
	availableBorrowsUSD: string;
	currentLiquidationThreshold: string;
	ltv: string;
	healthFactor: string;
}

export class AaveService {
	private publicClient: PublicClient;
	private walletClient?: WalletClient;
	private account?: Account;
	private userAddress?: Address;

	constructor(walletClient?: WalletClient) {
		this.publicClient = createPublicClient({
			chain: base,
			transport: http(RPC_URLS.base),
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
			NonceManager.getInstance().init(this.userAddress, this.publicClient);
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

		// Aave V3 getUserAccountData returns values in Base Currency (USD, 8 decimals)
		return {
			totalCollateralUSD: formatUnits(data[0], 8),
			totalDebtUSD: formatUnits(data[1], 8),
			availableBorrowsUSD: formatUnits(data[2], 8),
			currentLiquidationThreshold: formatUnits(data[3], 4),
			ltv: formatUnits(data[4], 4),
			healthFactor: formatUnits(data[5], 18),
		};
	}

	public async supply(tokenAddress: Address, amountStr: string): Promise<Hash> {
		this.ensureWalletConnection();

		const poolAddress = await this.getPoolAddress();
		const decimals = await this.getTokenDecimals(tokenAddress);
		const amount = parseUnits(amountStr, decimals);

		// Check Allowance & Approve if necessary
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
				chain: base,
				account: this.account!,
				nonce: nonceApprove,
			});
			await this.publicClient.waitForTransactionReceipt({ hash: txApprove });
		}

		// Execute Supply
		const nonceSupply = await NonceManager.getInstance().getNextNonce();
		const txSupply = await this.walletClient!.writeContract({
			address: poolAddress,
			abi: POOL_ABI,
			functionName: "supply",
			args: [tokenAddress, amount, this.account!.address, 0],
			chain: base,
			account: this.account!,
			nonce: nonceSupply,
		});

		await this.publicClient.waitForTransactionReceipt({ hash: txSupply });
		return txSupply;
	}

	public async wrapETH(amountStr: string): Promise<Hash> {
		this.ensureWalletConnection();

		const amount = parseUnits(amountStr, 18); // ETH always 18

		const nonce = await NonceManager.getInstance().getNextNonce();

		const txWrap = await this.walletClient!.writeContract({
			address: WETH_BASE_ADDRESS,
			abi: WETH_ABI,
			functionName: "deposit",
			args: [],
			value: amount,
			chain: base,
			account: this.account!,
			nonce,
		});

		await this.publicClient.waitForTransactionReceipt({ hash: txWrap });
		return txWrap;
	}

	public async unwrapWETH(amountStr: string): Promise<Hash> {
		this.ensureWalletConnection();

		const amount = parseUnits(amountStr, 18);

		const nonce = await NonceManager.getInstance().getNextNonce();

		const txUnwrap = await this.walletClient!.writeContract({
			address: WETH_BASE_ADDRESS,
			abi: WETH_ABI,
			functionName: "withdraw",
			args: [amount],
			chain: base,
			account: this.account!,
			nonce,
		});

		await this.publicClient.waitForTransactionReceipt({ hash: txUnwrap });
		return txUnwrap;
	}

	public async withdraw(tokenAddress: Address, amountStr: string): Promise<Hash> {
		this.ensureWalletConnection();

		const poolAddress = await this.getPoolAddress();
		const decimals = await this.getTokenDecimals(tokenAddress);
		const amount = parseUnits(amountStr, decimals);
		const userAddress = this.account!.address;

		const nonce = await NonceManager.getInstance().getNextNonce();

		// Simulate first to catch errors
		try {
			await this.publicClient.simulateContract({
				address: poolAddress,
				abi: POOL_ABI,
				functionName: "withdraw",
				args: [tokenAddress, amount, userAddress],
				account: userAddress,
			});
		} catch (error: any) {
			// Smart Error Handling
			const userData = await this.getUserAccountData(userAddress);
			const totalDebt = parseFloat(userData.totalDebtUSD);

			if (
				error.message?.includes("HealthFactorLowerThanLiquidationThreshold") ||
				error.cause?.message?.includes("0x6679996d")
			) {
				let details = "This amount would lower your Health Factor below 1.0.";

				if (totalDebt > 0 && totalDebt < 0.01) {
					details = `You have tiny "dust" debt ($${totalDebt.toFixed(6)}) preventing full withdrawal.`;
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

				throw new Error(`Cannot withdraw: ${details} (Try repaying all debt first)`);
			}
			throw error;
		}

		const txWithdraw = await this.walletClient!.writeContract({
			address: poolAddress,
			abi: POOL_ABI,
			functionName: "withdraw",
			args: [tokenAddress, amount, userAddress],
			chain: base,
			account: this.account!,
			nonce,
		});

		await this.publicClient.waitForTransactionReceipt({ hash: txWithdraw });
		return txWithdraw;
	}

	public async borrow(tokenAddress: Address, amountStr: string): Promise<Hash> {
		this.ensureWalletConnection();

		const poolAddress = await this.getPoolAddress();
		const decimals = await this.getTokenDecimals(tokenAddress);
		const amount = parseUnits(amountStr, decimals);

		const nonce = await NonceManager.getInstance().getNextNonce();

		// Simulate first to catch errors
		try {
			await this.publicClient.simulateContract({
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
				chain: base,
				account: this.account!,
			});
		} catch (error: any) {
			if (
				error.message?.includes("HealthFactorLowerThanLiquidationThreshold") ||
				error.cause?.message?.includes("0x6679996d")
			) {
				throw new Error(
					"Cannot borrow: This amount would lower your Health Factor below 1.0 (Liquidation Threshold). Try borrowing a smaller amount or adding more collateral first."
				);
			}
			throw error;
		}

		const txBorrow = await this.walletClient!.writeContract({
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
			chain: base,
			account: this.account!,
			nonce,
		});

		await this.publicClient.waitForTransactionReceipt({ hash: txBorrow });
		return txBorrow;
	}

	public async repay(tokenAddress: Address, amountStr: string): Promise<Hash> {
		this.ensureWalletConnection();

		const poolAddress = await this.getPoolAddress();
		const decimals = await this.getTokenDecimals(tokenAddress);
		const amount = parseUnits(amountStr, decimals);

		// Check Allowance & Approve if necessary
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
				chain: base,
				account: this.account!,
				nonce: nonceApprove,
			});
			await this.publicClient.waitForTransactionReceipt({ hash: txApprove });
		}

		// Execute Repay
		const nonceRepay = await NonceManager.getInstance().getNextNonce();

		const txRepay = await this.walletClient!.writeContract({
			address: poolAddress,
			abi: POOL_ABI,
			functionName: "repay",
			args: [tokenAddress, amount, BigInt(InterestRateMode.Variable), this.account!.address],
			chain: base,
			account: this.account!,
			nonce: nonceRepay,
		});

		await this.publicClient.waitForTransactionReceipt({ hash: txRepay });
		return txRepay;
	}

	private ensureWalletConnection() {
		if (!this.walletClient || !this.account) {
			throw new Error("Wallet not connected. Please login or provide a PRIVATE_KEY.");
		}
	}

	private async getTokenDecimals(tokenAddress: Address): Promise<number> {
		return await this.publicClient.readContract({
			address: tokenAddress,
			abi: erc20Abi,
			functionName: "decimals",
		});
	}
}
