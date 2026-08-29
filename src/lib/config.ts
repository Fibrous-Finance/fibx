import envPaths from "env-paths";

export const paths = envPaths("fibx");

export const FIBROUS_BASE_URL = "https://api.fibrous.finance";
export const FIBROUS_GRAPH_URL = "https://graph.fibrous.finance";

// Override with FIBX_API_URL env var for local dev
export const FIBX_API_URL_DEFAULT = "https://gmfg2nswbe.eu-west-1.awsapprunner.com";

// WalletConnect project id. This ships inside the published bundle and is
// therefore public — that is normal for a WalletConnect dapp. The origin
// allowlist Reown recommends does not apply to a CLI, which has no origin, so
// the exposure is quota consumption; rotate and republish if that becomes a
// problem.
export const WC_PROJECT_ID_DEFAULT = "1c19af9778708c97acf595733be5f30d";

export function getWcProjectId(): string {
	return process.env.FIBX_WC_PROJECT_ID ?? WC_PROJECT_ID_DEFAULT;
}

export const WC_STORAGE_FILE = "walletconnect.json";

export const DEFAULT_SLIPPAGE = 0.5;
export const TOKEN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
