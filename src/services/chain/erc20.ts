import { encodeFunctionData, type Address, type PublicClient } from "viem";

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

export const WETH_ABI = [
	{
		constant: true,
		inputs: [],
		name: "name",
		outputs: [{ name: "", type: "string" }],
		payable: false,
		stateMutability: "view",
		type: "function",
	},
	{
		constant: false,
		inputs: [
			{ name: "guy", type: "address" },
			{ name: "wad", type: "uint256" },
		],
		name: "approve",
		outputs: [{ name: "", type: "bool" }],
		payable: false,
		stateMutability: "nonpayable",
		type: "function",
	},
	{
		constant: true,
		inputs: [],
		name: "totalSupply",
		outputs: [{ name: "", type: "uint256" }],
		payable: false,
		stateMutability: "view",
		type: "function",
	},
	{
		constant: false,
		inputs: [
			{ name: "src", type: "address" },
			{ name: "dst", type: "address" },
			{ name: "wad", type: "uint256" },
		],
		name: "transferFrom",
		outputs: [{ name: "", type: "bool" }],
		payable: false,
		stateMutability: "nonpayable",
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
		inputs: [],
		name: "decimals",
		outputs: [{ name: "", type: "uint8" }],
		payable: false,
		stateMutability: "view",
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
	{
		constant: true,
		inputs: [],
		name: "symbol",
		outputs: [{ name: "", type: "string" }],
		payable: false,
		stateMutability: "view",
		type: "function",
	},
	{
		constant: false,
		inputs: [
			{ name: "dst", type: "address" },
			{ name: "wad", type: "uint256" },
		],
		name: "transfer",
		outputs: [{ name: "", type: "bool" }],
		payable: false,
		stateMutability: "nonpayable",
		type: "function",
	},
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
		constant: true,
		inputs: [
			{ name: "", type: "address" },
			{ name: "", type: "address" },
		],
		name: "allowance",
		outputs: [{ name: "", type: "uint256" }],
		payable: false,
		stateMutability: "view",
		type: "function",
	},
	{ payable: true, stateMutability: "payable", type: "fallback" },
	{
		anonymous: false,
		inputs: [
			{ indexed: true, name: "src", type: "address" },
			{ indexed: true, name: "guy", type: "address" },
			{ indexed: false, name: "wad", type: "uint256" },
		],
		name: "Approval",
		type: "event",
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, name: "src", type: "address" },
			{ indexed: true, name: "dst", type: "address" },
			{ indexed: false, name: "wad", type: "uint256" },
		],
		name: "Transfer",
		type: "event",
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, name: "dst", type: "address" },
			{ indexed: false, name: "wad", type: "uint256" },
		],
		name: "Deposit",
		type: "event",
	},
	{
		anonymous: false,
		inputs: [
			{ indexed: true, name: "src", type: "address" },
			{ indexed: false, name: "wad", type: "uint256" },
		],
		name: "Withdrawal",
		type: "event",
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
