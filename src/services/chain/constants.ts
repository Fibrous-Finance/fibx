import type { Abi } from "viem";
import { type Chain, defineChain } from "viem";
import { base } from "viem/chains";
import { baseRouterAbi } from "../fibrous/abi/base.js";
import { citreaRouterAbi } from "../fibrous/abi/citrea.js";
import { hyperevmRouterAbi } from "../fibrous/abi/hyperevm.js";
import { monadRouterAbi } from "../fibrous/abi/monad.js";

export const citrea = defineChain({
	id: 4114,
	name: "Citrea",
	nativeCurrency: { name: "cBTC", symbol: "cBTC", decimals: 18 },
	rpcUrls: {
		default: { http: ["https://rpc.citrea.xyz"] },
	},
	blockExplorers: {
		default: { name: "Citrea Explorer", url: "https://explorer.mainnet.citrea.xyz" },
	},
});

export const hyperevm = defineChain({
	id: 998,
	name: "HyperEVM",
	nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
	rpcUrls: {
		default: { http: ["https://rpc.hyperevm.xyz"] },
	},
});

export const monad = defineChain({
	id: 143,
	name: "Monad",
	nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
	rpcUrls: {
		default: { http: ["https://rpc.monad.xyz"] },
	},
	blockExplorers: {
		default: {
			name: "MonadVision",
			url: "https://monadvision.com",
		},
	},
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
		rpcUrl: "https://rpc.citrea.xyz",
		nativeTokenAddress: "0x0000000000000000000000000000000000000000",
		fibrousNetwork: "citrea",
		routerAbi: citreaRouterAbi as Abi,
	},
	hyperevm: {
		id: 998,
		name: "hyperevm",
		viemChain: hyperevm,
		rpcUrl: "https://rpc.hyperevm.xyz",
		nativeTokenAddress: "0x0000000000000000000000000000000000000000",
		fibrousNetwork: "hyperevm",
		routerAbi: hyperevmRouterAbi as Abi,
	},
	monad: {
		id: 143,
		name: "monad",
		viemChain: monad,
		rpcUrl: "https://rpc.monad.xyz",
		nativeTokenAddress: "0x0000000000000000000000000000000000000000",
		fibrousNetwork: "monad",
		routerAbi: monadRouterAbi as Abi,
	},
};

export function getChainConfig(network: string): ChainConfig {
	const config = SUPPORTED_CHAINS[network];
	if (!config) {
		throw new Error(
			`Unsupported chain: ${network}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`
		);
	}
	return config;
}
