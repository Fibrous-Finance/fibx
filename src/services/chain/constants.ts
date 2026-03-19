import { ErrorCode, FibxError } from "../../lib/errors.js";
import { configService } from "../config/config.js";
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
	nativeSymbol: string;
	viemChain: Chain;
	rpcUrl: string;
	nativeTokenAddress: string;
	wrappedNativeAddress: string;
	fibrousNetwork: string;
	routerAbi:
		| typeof baseRouterAbi
		| typeof citreaRouterAbi
		| typeof hyperevmRouterAbi
		| typeof monadRouterAbi;
}

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
		routerAbi: citreaRouterAbi,
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
		routerAbi: hyperevmRouterAbi,
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
		routerAbi: monadRouterAbi,
	},
};

export function getChainConfig(network: string): ChainConfig {
	const config = SUPPORTED_CHAINS[network];
	if (!config) {
		const supported = Object.keys(SUPPORTED_CHAINS).join(", ");
		throw new FibxError(
			ErrorCode.UNSUPPORTED_CHAIN,
			`Unsupported chain: ${network}. Supported: ${supported}`
		);
	}

	// Override RPC URL if custom config exists
	const customRpc = configService.getRpcUrl(network);
	if (customRpc) {
		return {
			...config,
			rpcUrl: customRpc,
		};
	}

	return config;
}
