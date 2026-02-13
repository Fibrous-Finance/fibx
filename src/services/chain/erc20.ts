import { encodeFunctionData, type Address, type PublicClient } from "viem";

const ERC20_ABI = [
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

export function encodeTransfer(to: Address, amount: bigint): `0x${string}` {
	return encodeFunctionData({
		abi: ERC20_ABI,
		functionName: "transfer",
		args: [to, amount],
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
