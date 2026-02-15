import type { Abi } from "viem";
import { type Chain, defineChain } from "viem";
import { base } from "viem/chains";
import { baseRouterAbi } from "../fibrous/abi/base.js";
import { citreaRouterAbi } from "../fibrous/abi/citrea.js";
import { hyperevmRouterAbi } from "../fibrous/abi/hyperevm.js";
import { monadRouterAbi } from "../fibrous/abi/monad.js";

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
	viemChain: Chain;
	rpcUrl: string;
	nativeTokenAddress: string;
	fibrousNetwork: string;
	routerAbi: Abi;
}

export const SUPPORTED_CHAINS: Record<string, ChainConfig> = {
	base: {
		id: 8453,
		name: "base",
		viemChain: base,
		rpcUrl: "https://mainnet.base.org",
		nativeTokenAddress: "0x0000000000000000000000000000000000000000",
		fibrousNetwork: "base",
		routerAbi: baseRouterAbi as Abi,
	},
	citrea: {
		id: 4114,
		name: "citrea",
		viemChain: citrea,
		rpcUrl: "https://rpc.mainnet.citrea.xyz",
		nativeTokenAddress: "0x0000000000000000000000000000000000000000",
		fibrousNetwork: "citrea",
		routerAbi: citreaRouterAbi as Abi,
	},
	hyperevm: {
		id: 999,
		name: "hyperevm",
		viemChain: hyperevm,
		rpcUrl: "https://rpc.hyperliquid.xyz/evm",
		nativeTokenAddress: "0x0000000000000000000000000000000000000000",
		fibrousNetwork: "hyperevm",
		routerAbi: hyperevmRouterAbi as Abi,
	},
	monad: {
		id: 143,
		name: "monad",
		viemChain: monad,
		rpcUrl: "https://rpc-mainnet.monadinfra.com",
		nativeTokenAddress: "0x0000000000000000000000000000000000000000",
		fibrousNetwork: "monad",
		routerAbi: monadRouterAbi as Abi,
	},
};

export const RPC_URLS = {
	base: "https://mainnet.base.org",
	citrea: "https://rpc.mainnet.citrea.xyz",
	hyperevm: "https://rpc.hyperliquid.xyz/evm",
	monad: "https://rpc-mainnet.monadinfra.com",
};

export function getChainConfig(network: string): ChainConfig {
	const config = SUPPORTED_CHAINS[network];
	if (!config) {
		const supported = Object.keys(SUPPORTED_CHAINS).join(", ");
		throw new Error(`Unsupported chain: ${network}. Supported: ${supported}`);
	}
	return config;
}
