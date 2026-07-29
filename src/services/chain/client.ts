import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Session } from "../auth/session.js";
import { getPrivateKey } from "../auth/session.js";
import type { ChainConfig } from "./constants.js";
import { toPrivyViemAccount } from "../privy/account.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

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
		if (!token) {
			throw new FibxError(
				ErrorCode.SESSION_EXPIRED,
				"Session JWT missing. Run `fibx auth login <email>` to re-authenticate."
			);
		}
		const walletId = session.walletId;
		if (!walletId) {
			throw new FibxError(
				ErrorCode.WALLET_ERROR,
				"Wallet ID missing from session. Run `fibx auth login <email>` to re-authenticate."
			);
		}

		account = toPrivyViemAccount(token, walletId, session.walletAddress);
	}

	return createWalletClient({
		account,
		chain: chain.viemChain,
		transport: http(chain.rpcUrl),
	});
}
