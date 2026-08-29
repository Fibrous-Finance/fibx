import { ErrorCode, FibxError } from "../../lib/errors.js";
import { configService } from "../config/config.js";
import { type Chain, defineChain } from "viem";
import { base } from "viem/chains";
import { baseRouterAbi } from "../fibrous/abi/base.js";
import { standardRouterAbi } from "../fibrous/abi/standard.js";

export const citrea = defineChain({
	id: 4114,
	name: "Citrea Mainnet",
	nativeCurrency: { name: "Citrea Bitcoin", symbol: "cBTC", decimals: 18 },
	rpcUrls: {
		default: { http: ["https://rpc.mainnet.citrea.xyz"] },
	},
	blockExplorers: {
		default: {
			name: "Citrea Explorer",
			url: "https://explorer.mainnet.citrea.xyz",
			apiUrl: "https://explorer.mainnet.citrea.xyz/api",
		},
	},
	testnet: false,
});

export const hyperevm = defineChain({
	id: 999,
	name: "HyperEVM",
	nativeCurrency: { name: "Hyperliquid", symbol: "HYPE", decimals: 18 },
	rpcUrls: {
		default: { http: ["https://rpc.hyperliquid.xyz/evm"] },
	},
	blockExplorers: {
		default: {
			name: "HyperEVM Scan",
			url: "https://hyperevmscan.io",
			apiUrl: "https://hyperevmscan.io/api",
		},
	},
	testnet: false,
});

export const monad = defineChain({
	id: 143,
	name: "Monad Mainnet",
	nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
	rpcUrls: {
		default: { http: ["https://rpc-mainnet.monadinfra.com"] },
	},
	blockExplorers: {
		default: {
			name: "Monad Vision",
			url: "https://monadvision.com",
			apiUrl: "https://monadvision.com/api",
		},
	},
	testnet: false,
});

export interface ChainConfig {
	id: number;
	name: string;
	nativeSymbol: string;
	viemChain: Chain;
	rpcUrl: string;
	nativeTokenAddress: string;
	wrappedNativeAddress: string;
	fibrousNetwork: string;
	routerAbi: typeof baseRouterAbi | typeof standardRouterAbi;
}

/**
 * What the CLI offers, one entry per chain. The MCP tool schemas derive their
 * `chain` enum from this and getChainConfig gates on it, so adding a chain here
 * surfaces it everywhere and removing one withdraws it everywhere.
 *
 * Withdrawing a chain leaves its row in SUPPORTED_CHAINS below. The code to
 * talk to it — viem chain definition, router ABI, RPC — stays; it just stops
 * being offered. This is a literal rather than a filter over SUPPORTED_CHAINS
 * because ChainEnum needs the tuple type to build the MCP enum.
 *
 * Citrea was withdrawn on 2026-08-29: Fibrous delisted it upstream on
 * 2026-08-10 and took its router (502 on every path) and graph service (404)
 * down with it, so quotes, trades and balances cannot work there.
 */
export const CHAIN_NAMES = ["base", "hyperevm", "monad"] as const;
export type ChainName = (typeof CHAIN_NAMES)[number];

function isOffered(network: string): network is ChainName {
	return (CHAIN_NAMES as readonly string[]).includes(network);
}

/**
 * Every chain this codebase knows how to talk to, offered or not. Structural:
 * keyed lookups resolve through it, and a withdrawn chain needs its row to
 * exist for anything still holding a reference to it.
 */
export const SUPPORTED_CHAINS: Record<string, ChainConfig> = {
	base: {
		id: 8453,
		name: "base",
		nativeSymbol: "ETH",
		viemChain: base,
		rpcUrl: "https://mainnet.base.org",
		nativeTokenAddress: "0x0000000000000000000000000000000000000000",
		wrappedNativeAddress: "0x4200000000000000000000000000000000000006",
		fibrousNetwork: "base",
		routerAbi: baseRouterAbi,
	},
	citrea: {
		id: 4114,
		name: "citrea",
		nativeSymbol: "cBTC",
		viemChain: citrea,
		rpcUrl: "https://rpc.mainnet.citrea.xyz",
		nativeTokenAddress: "0x0000000000000000000000000000000000000000",
		wrappedNativeAddress: "0x3100000000000000000000000000000000000006",
		fibrousNetwork: "citrea",
		routerAbi: standardRouterAbi,
	},
	hyperevm: {
		id: 999,
		name: "hyperevm",
		nativeSymbol: "HYPE",
		viemChain: hyperevm,
		rpcUrl: "https://rpc.hyperliquid.xyz/evm",
		nativeTokenAddress: "0x0000000000000000000000000000000000000000",
		wrappedNativeAddress: "0x5555555555555555555555555555555555555555",
		fibrousNetwork: "hyperevm",
		routerAbi: standardRouterAbi,
	},
	monad: {
		id: 143,
		name: "monad",
		nativeSymbol: "MON",
		viemChain: monad,
		rpcUrl: "https://rpc-mainnet.monadinfra.com",
		nativeTokenAddress: "0x0000000000000000000000000000000000000000",
		wrappedNativeAddress: "0x3bd359c1119da7da1d913d1c4d2b7c461115433a",
		fibrousNetwork: "monad",
		routerAbi: standardRouterAbi,
	},
};

export function getChainConfig(network: string): ChainConfig {
	const config = SUPPORTED_CHAINS[network];
	if (!config || !isOffered(network)) {
		const supported = CHAIN_NAMES.join(", ");
		throw new FibxError(
			ErrorCode.UNSUPPORTED_CHAIN,
			`Unsupported chain: ${network}. Supported: ${supported}`
		);
	}

	const customRpc = configService.getRpcUrl(network);
	if (customRpc) {
		return {
			...config,
			rpcUrl: customRpc,
		};
	}

	return config;
}
