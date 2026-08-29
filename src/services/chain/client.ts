import { createPublicClient, createWalletClient, custom, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Session } from "../auth/session.js";
import { getPrivateKey } from "../auth/session.js";
import type { ChainConfig } from "./constants.js";
import { toPrivyViemAccount } from "../privy/account.js";
import { createWalletConnectProvider } from "../walletconnect/provider.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

export function getPublicClient(chain: ChainConfig) {
	return createPublicClient({
		chain: chain.viemChain,
		transport: http(chain.rpcUrl),
	});
}

/**
 * True when the remote wallet assigns the nonce itself. Over WalletConnect the
 * wallet both signs and broadcasts, so forcing a nonce invites a conflict;
 * FibX's NonceManager still owns the nonce on every other path.
 */
export function managesOwnNonce(session: Session): boolean {
	return session.type === "walletconnect";
}

/**
 * Async because initialising the WalletConnect client opens a relay connection.
 * The alternative — a module-level singleton with a synchronous accessor — hides
 * an ordering requirement in global state and fails far from its cause.
 */
export async function getWalletClient(session: Session, chain: ChainConfig) {
	if (session.type === "walletconnect") {
		if (!session.wcTopic) {
			throw new FibxError(
				ErrorCode.WALLET_ERROR,
				"WalletConnect session has no pairing. Run `fibx auth connect`."
			);
		}

		// The account is a bare address, not a local account: that makes viem
		// emit eth_sendTransaction through the transport instead of signing
		// locally and calling eth_sendRawTransaction. MetaMask does not
		// implement eth_signTransaction over WalletConnect.
		return createWalletClient({
			account: session.walletAddress as `0x${string}`,
			chain: chain.viemChain,
			transport: custom(createWalletConnectProvider(session.wcTopic, chain)),
		});
	}

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
