import envPaths from "env-paths";

export const paths = envPaths("fibx");

export const FIBROUS_BASE_URL = "https://api.fibrous.finance";
export const FIBROUS_GRAPH_URL = "https://graph.fibrous.finance";

export const DEFAULT_SLIPPAGE = 0.5;
export const TOKEN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
