import type { Address } from "viem";

/**
 * Aave V3 Pool Addresses Provider on Base Mainnet.
 * @see https://docs.aave.com/developers/deployed-contracts/v3-mainnet/base
 */
export const AAVE_V3_POOL_ADDRESSES_PROVIDER =
	"0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D" as Address;

// Health Factor Thresholds for risk assessment.
export const HEALTH_FACTOR_WARNING_THRESHOLD = 1.5;
export const HEALTH_FACTOR_CRITICAL_THRESHOLD = 1.1;

export const WETH_BASE_ADDRESS = "0x4200000000000000000000000000000000000006" as Address;

// Aave Interest Rate Modes
export enum InterestRateMode {
	None = 0,
	Stable = 1,
	Variable = 2,
}
