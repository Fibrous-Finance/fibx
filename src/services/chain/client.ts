import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Session } from "../auth/session.js";
import type { ChainConfig } from "./constants.js";
import { toPrivyViemAccount } from "../privy/account.js";

export function getPublicClient(chain: ChainConfig) {
	return createPublicClient({
		chain: chain.viemChain,
		transport: http(chain.rpcUrl),
	});
}

export function getWalletClient(session: Session, chain: ChainConfig) {
	let account;

	if (session.type === "private-key" && session.privateKey) {
		account = privateKeyToAccount(session.privateKey as `0x${string}`);
	} else {
		// Privy session: use backend-backed signing via JWT
		const token = session.userJwt;
		if (!token) throw new Error("Session JWT required for privy session type");
		const walletId = session.walletId;
		if (!walletId) throw new Error("Wallet ID required for privy session");

		account = toPrivyViemAccount(token, walletId, session.walletAddress);
	}

	return createWalletClient({
		account,
		chain: chain.viemChain,
		transport: http(chain.rpcUrl),
	});
}
