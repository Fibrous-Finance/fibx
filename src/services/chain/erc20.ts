import { encodeFunctionData, type Address, type PublicClient } from "viem";
import { ErrorCode, FibxError } from "../../lib/errors.js";

export const ERC20_ABI = [
	{
		name: "balanceOf",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "account", type: "address" }],
		outputs: [{ name: "", type: "uint256" }],
	},
	{
		name: "transfer",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "to", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [{ name: "", type: "bool" }],
	},
	{
		name: "approve",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "spender", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [{ name: "", type: "bool" }],
	},
	{
		name: "allowance",
		type: "function",
		stateMutability: "view",
		inputs: [
			{ name: "owner", type: "address" },
			{ name: "spender", type: "address" },
		],
		outputs: [{ name: "", type: "uint256" }],
	},
] as const;

export async function getERC20Balance(
	client: PublicClient,
	tokenAddress: Address,
	walletAddress: Address
): Promise<bigint> {
	return client.readContract({
		address: tokenAddress,
		abi: ERC20_ABI,
		functionName: "balanceOf",
		args: [walletAddress],
	});
}

export function encodeApprove(spender: Address, amount: bigint): `0x${string}` {
	return encodeFunctionData({
		abi: ERC20_ABI,
		functionName: "approve",
		args: [spender, amount],
	});
}

export async function getAllowance(
	client: PublicClient,
	tokenAddress: Address,
	owner: Address,
	spender: Address
): Promise<bigint> {
	return client.readContract({
		address: tokenAddress,
		abi: ERC20_ABI,
		functionName: "allowance",
		args: [owner, spender],
	});
}

// Polls allowance until it reaches the target amount (handles RPC propagation lag).
export async function waitForAllowance(
	client: PublicClient,
	tokenAddress: Address,
	owner: Address,
	spender: Address,
	targetAmount: bigint,
	maxRetries: number = 15,
	intervalMs: number = 2000
): Promise<void> {
	let retries = 0;
	let lastAllowance = 0n;
	while (retries < maxRetries) {
		lastAllowance = await getAllowance(client, tokenAddress, owner, spender);
		if (lastAllowance >= targetAmount) return;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
		retries++;
	}

	// Proceeding without a confirmed allowance would revert on-chain and burn gas,
	// so surface the timeout instead of silently continuing.
	throw new FibxError(
		ErrorCode.RPC_ERROR,
		`Approval did not propagate after ${(maxRetries * intervalMs) / 1000}s. ` +
			`Allowance is ${lastAllowance}, needed ${targetAmount}. Please retry.`
	);
}

export const WETH_ABI = [
	{
		constant: false,
		inputs: [],
		name: "deposit",
		outputs: [],
		payable: true,
		stateMutability: "payable",
		type: "function",
	},
	{
		constant: false,
		inputs: [{ name: "wad", type: "uint256" }],
		name: "withdraw",
		outputs: [],
		payable: false,
		stateMutability: "nonpayable",
		type: "function",
	},
	{
		constant: true,
		inputs: [{ name: "", type: "address" }],
		name: "balanceOf",
		outputs: [{ name: "", type: "uint256" }],
		payable: false,
		stateMutability: "view",
		type: "function",
	},
] as const;

export function encodeDeposit(): `0x${string}` {
	return encodeFunctionData({
		abi: WETH_ABI,
		functionName: "deposit",
	});
}

export function encodeWithdraw(amount: bigint): `0x${string}` {
	return encodeFunctionData({
		abi: WETH_ABI,
		functionName: "withdraw",
		args: [amount],
	});
}
