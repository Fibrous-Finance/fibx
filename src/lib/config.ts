import envPaths from "env-paths";

export const paths = envPaths("fibx");

export const FIBROUS_BASE_URL = "https://api.fibrous.finance";
export const FIBROUS_GRAPH_URL = "https://graph.fibrous.finance";

// Hardcoded default API URL for the package
// Users can override this with FIBX_API_URL env var if needed (e.g. for local dev)
export const FIBX_API_URL_DEFAULT = "https://gmfg2nswbe.eu-west-1.awsapprunner.com";

export const DEFAULT_SLIPPAGE = 0.5;
export const TOKEN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
