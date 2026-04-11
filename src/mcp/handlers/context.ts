import type { Address, PublicClient, WalletClient } from "viem";
import { requireSession, type Session } from "../../services/auth/session.js";
import { getChainConfig, type ChainConfig } from "../../services/chain/constants.js";
import { getPublicClient, getWalletClient } from "../../services/chain/client.js";

export interface WalletContext {
	session: Session;
	walletClient: WalletClient;
	publicClient: PublicClient;
	wallet: Address;
	chain: ChainConfig;
}

/**
 * Creates a full wallet context for MCP handlers that need to write transactions.
 */
export async function withWallet<T>(
	fn: (ctx: WalletContext) => Promise<T>,
	chainName?: string
): Promise<T> {
	const session = requireSession();
	const chain = getChainConfig(chainName ?? "base");
	const walletClient = getWalletClient(session, chain);
	const publicClient = getPublicClient(chain);
	const wallet = session.walletAddress as Address;

	return fn({ session, walletClient, publicClient, wallet, chain });
}

/**
 * Creates a read-only context for MCP handlers that only need to query data.
 */
export async function withReadonlyWallet<T>(
	fn: (ctx: Omit<WalletContext, "walletClient">) => Promise<T>,
	chainName?: string
): Promise<T> {
	const session = requireSession();
	const chain = getChainConfig(chainName ?? "base");
	const publicClient = getPublicClient(chain);
	const wallet = session.walletAddress as Address;

	return fn({ session, publicClient, wallet, chain });
}
