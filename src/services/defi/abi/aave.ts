export const POOL_ADDRESSES_PROVIDER_ABI = [
	{
		name: "getPool",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "address" }],
	},
	{
		name: "getPoolDataProvider",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "address" }],
	},
] as const;

export const POOL_DATA_PROVIDER_ABI = [
	{
		name: "getUserReserveData",
		type: "function",
		stateMutability: "view",
		inputs: [
			{ name: "asset", type: "address" },
			{ name: "user", type: "address" },
		],
		outputs: [
			{ name: "currentATokenBalance", type: "uint256" },
			{ name: "currentStableDebt", type: "uint256" },
			{ name: "currentVariableDebt", type: "uint256" },
			{ name: "principalStableDebt", type: "uint256" },
			{ name: "scaledVariableDebt", type: "uint256" },
			{ name: "stableBorrowRate", type: "uint256" },
			{ name: "liquidityRate", type: "uint256" },
			{ name: "stableRateLastUpdated", type: "uint40" },
			{ name: "usageAsCollateralEnabled", type: "bool" },
		],
	},
	{
		name: "getAllReservesTokens",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [
			{
				type: "tuple[]",
				components: [
					{ name: "symbol", type: "string" },
					{ name: "tokenAddress", type: "address" },
				],
			},
		],
	},
	{
		name: "getReserveData",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "asset", type: "address" }],
		outputs: [
			{ name: "unbacked", type: "uint256" },
			{ name: "accruedToTreasuryScaled", type: "uint256" },
			{ name: "totalAToken", type: "uint256" },
			{ name: "totalStableDebt", type: "uint256" },
			{ name: "totalVariableDebt", type: "uint256" },
			{ name: "liquidityRate", type: "uint256" },
			{ name: "variableBorrowRate", type: "uint256" },
			{ name: "stableBorrowRate", type: "uint256" },
			{ name: "averageStableBorrowRate", type: "uint256" },
			{ name: "liquidityIndex", type: "uint256" },
			{ name: "variableBorrowIndex", type: "uint256" },
			{ name: "lastUpdateTimestamp", type: "uint40" },
		],
	},
	{
		name: "getReserveConfigurationData",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "asset", type: "address" }],
		outputs: [
			{ name: "decimals", type: "uint256" },
			{ name: "ltv", type: "uint256" },
			{ name: "liquidationThreshold", type: "uint256" },
			{ name: "liquidationBonus", type: "uint256" },
			{ name: "reserveFactor", type: "uint256" },
			{ name: "usageAsCollateralEnabled", type: "bool" },
			{ name: "borrowingEnabled", type: "bool" },
			{ name: "stableBorrowRateEnabled", type: "bool" },
			{ name: "isActive", type: "bool" },
			{ name: "isFrozen", type: "bool" },
		],
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
	{
		inputs: [],
		name: "NoDebtOfSelectedType",
		type: "error",
	},
	{
		name: "getReservesList",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "address[]" }],
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
