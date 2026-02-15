import {
	createPublicClient,
	createWalletClient,
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
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { RPC_URLS } from "../chain/constants.js";
import { POOL_ADDRESSES_PROVIDER_ABI, POOL_ABI } from "./abi/aave.js";
import { AAVE_V3_POOL_ADDRESSES_PROVIDER, InterestRateMode } from "./constants.js";

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

	constructor(privateKey?: string) {
		this.publicClient = createPublicClient({
			chain: base,
			transport: http(RPC_URLS.base),
		}) as PublicClient;

		if (privateKey) {
			this.account = privateKeyToAccount(privateKey as Hash);
			this.walletClient = createWalletClient({
				account: this.account,
				chain: base,
				transport: http(RPC_URLS.base),
			});
			this.userAddress = this.account.address;
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
			const txApprove = await this.walletClient!.writeContract({
				address: tokenAddress,
				abi: erc20Abi,
				functionName: "approve",
				args: [poolAddress, amount],
				chain: base,
				account: this.account!,
			});
			await this.publicClient.waitForTransactionReceipt({ hash: txApprove });
		}

		// Execute Supply
		const txSupply = await this.walletClient!.writeContract({
			address: poolAddress,
			abi: POOL_ABI,
			functionName: "supply",
			args: [tokenAddress, amount, this.account!.address, 0],
			chain: base,
			account: this.account!,
		});

		await this.publicClient.waitForTransactionReceipt({ hash: txSupply });
		return txSupply;
	}

	public async withdraw(tokenAddress: Address, amountStr: string): Promise<Hash> {
		this.ensureWalletConnection();

		const poolAddress = await this.getPoolAddress();
		const decimals = await this.getTokenDecimals(tokenAddress);
		const amount = parseUnits(amountStr, decimals);

		const txWithdraw = await this.walletClient!.writeContract({
			address: poolAddress,
			abi: POOL_ABI,
			functionName: "withdraw",
			args: [tokenAddress, amount, this.account!.address],
			chain: base,
			account: this.account!,
		});

		await this.publicClient.waitForTransactionReceipt({ hash: txWithdraw });
		return txWithdraw;
	}

	public async borrow(tokenAddress: Address, amountStr: string): Promise<Hash> {
		this.ensureWalletConnection();

		const poolAddress = await this.getPoolAddress();
		const decimals = await this.getTokenDecimals(tokenAddress);
		const amount = parseUnits(amountStr, decimals);

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
			const txApprove = await this.walletClient!.writeContract({
				address: tokenAddress,
				abi: erc20Abi,
				functionName: "approve",
				args: [poolAddress, amount],
				chain: base,
				account: this.account!,
			});
			await this.publicClient.waitForTransactionReceipt({ hash: txApprove });
		}

		// Execute Repay
		const txRepay = await this.walletClient!.writeContract({
			address: poolAddress,
			abi: POOL_ABI,
			functionName: "repay",
			args: [tokenAddress, amount, BigInt(InterestRateMode.Variable), this.account!.address],
			chain: base,
			account: this.account!,
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
