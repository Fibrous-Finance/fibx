export const POOL_ADDRESSES_PROVIDER_ABI = [
	{
		name: "getPool",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "address" }],
	},
] as const;

export const POOL_ABI = [
	{
		name: "supply",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "asset", type: "address" },
			{ name: "amount", type: "uint256" },
			{ name: "onBehalfOf", type: "address" },
			{ name: "referralCode", type: "uint16" },
		],
		outputs: [],
	},
	{
		name: "withdraw",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "asset", type: "address" },
			{ name: "amount", type: "uint256" },
			{ name: "to", type: "address" },
		],
		outputs: [{ type: "uint256" }],
	},
	{
		name: "borrow",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "asset", type: "address" },
			{ name: "amount", type: "uint256" },
			{ name: "interestRateMode", type: "uint256" }, // 2 = Variable
			{ name: "referralCode", type: "uint16" },
			{ name: "onBehalfOf", type: "address" },
		],
		outputs: [],
	},
	{
		name: "repay",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "asset", type: "address" },
			{ name: "amount", type: "uint256" },
			{ name: "interestRateMode", type: "uint256" }, // 2 = Variable
			{ name: "onBehalfOf", type: "address" },
		],
		outputs: [{ type: "uint256" }],
	},
	{
		inputs: [{ internalType: "address", name: "user", type: "address" }],
		name: "getUserAccountData",
		outputs: [
			{ internalType: "uint256", name: "totalCollateralBase", type: "uint256" },
			{ internalType: "uint256", name: "totalDebtBase", type: "uint256" },
			{ internalType: "uint256", name: "availableBorrowsBase", type: "uint256" },
			{ internalType: "uint256", name: "currentLiquidationThreshold", type: "uint256" },
			{ internalType: "uint256", name: "ltv", type: "uint256" },
			{ internalType: "uint256", name: "healthFactor", type: "uint256" },
		],
		stateMutability: "view",
		type: "function",
	},
	{
		inputs: [],
		name: "ValidationLogicError",
		type: "error",
	},
	{
		inputs: [],
		name: "HealthFactorLowerThanLiquidationThreshold",
		type: "error",
	},
] as const;

export const WETH_ABI = [
	{
		name: "deposit",
		type: "function",
		stateMutability: "payable",
		inputs: [],
		outputs: [],
	},
	{
		name: "withdraw",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [{ name: "wad", type: "uint256" }],
		outputs: [],
	},
] as const;
