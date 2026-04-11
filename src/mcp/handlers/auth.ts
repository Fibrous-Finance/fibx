import { loadSession } from "../../services/auth/session.js";
import { getChainConfig, SUPPORTED_CHAINS } from "../../services/chain/constants.js";
import { checkHealth } from "../../services/fibrous/health.js";
import { jsonResult } from "./utils.js";

export async function handleGetAuthStatus({ chain }: { chain: string }) {
	const session = loadSession();
	const chainConfig = getChainConfig(chain);

	let fibrousStatus = "unreachable";
	try {
		const health = await checkHealth(chainConfig);
		fibrousStatus = health.message;
	} catch {
		fibrousStatus = "unreachable";
	}

	if (!session) {
		return jsonResult({
			authenticated: false,
			walletAddress: null,
			sessionType: null,
			chain: chainConfig.name,
			fibrousStatus,
		});
	}

	return jsonResult({
		authenticated: true,
		walletAddress: session.walletAddress,
		sessionType: session.type,
		chain: chainConfig.name,
		fibrousStatus,
	});
}

export async function handleConfigAction({
	action,
	chain,
	url,
}: {
	action: "set-rpc" | "get-rpc" | "reset-rpc" | "list";
	chain?: string;
	url?: string;
}) {
	const { configService } = await import("../../services/config/config.js");

	if (action === "list") {
		const config = configService.getConfig();
		return jsonResult({ action, rpcUrls: config.rpcUrls });
	}

	if (action === "reset-rpc") {
		if (chain) {
			if (!SUPPORTED_CHAINS[chain]) {
				throw new Error(
					`Unsupported chain: ${chain}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`
				);
			}
			configService.resetRpcUrl(chain);
			return jsonResult({ action, chain, url: SUPPORTED_CHAINS[chain]?.rpcUrl });
		}
		configService.resetAll();
		return jsonResult({ action, rpcUrls: {} });
	}

	if (!chain) throw new Error("Chain is required for this action.");
	if (!SUPPORTED_CHAINS[chain]) {
		throw new Error(
			`Unsupported chain: ${chain}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`
		);
	}

	if (action === "get-rpc") {
		const customUrl = configService.getRpcUrl(chain);
		const defaultUrl = SUPPORTED_CHAINS[chain]?.rpcUrl;
		return jsonResult({ action, chain, url: customUrl || defaultUrl });
	}

	if (!url) throw new Error("URL is required for set-rpc.");
	try {
		new URL(url);
	} catch {
		throw new Error("Invalid URL format.");
	}

	configService.setRpcUrl(chain, url);
	return jsonResult({ action, chain, url });
}
