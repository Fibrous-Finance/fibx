import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Session } from "../auth/session.js";
import { getPrivateKey } from "../auth/session.js";
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

	const pk = getPrivateKey(session);
	if (session.type === "private-key" && pk) {
		account = privateKeyToAccount(pk as `0x${string}`);
	} else {
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
