import { createPublicClient, createWalletClient, custom, http } from "viem";
import type { LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Session } from "../auth/session.js";
import { getPrivateKey } from "../auth/session.js";
import type { ChainConfig } from "./constants.js";
import { toPrivyViemAccount } from "../privy/account.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";
import { assertAllowed } from "../policy/enforce.js";

export function getPublicClient(chain: ChainConfig) {
	return createPublicClient({
		chain: chain.viemChain,
		transport: http(chain.rpcUrl),
	});
}

/**
 * Puts the policy gate on an account's signTransaction.
 *
 * This is the last point where the transaction is readable and the last before
 * anything reaches the network. Wrapping the wallet client instead would miss
 * writeContract — Aave's eight writes reach the transport through viem's own
 * action, not through a method we could have overridden.
 */
function withPolicy<T extends LocalAccount>(account: T, chain: ChainConfig): T {
	return {
		...account,
		async signTransaction(transaction: Parameters<T["signTransaction"]>[0], args?: unknown) {
			assertAllowed({
				chain: chain.name,
				to: transaction.to ?? undefined,
				value: transaction.value ?? 0n,
			});
			return (account.signTransaction as (t: unknown, a?: unknown) => Promise<`0x${string}`>)(
				transaction,
				args
			);
		},
	} as T;
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

		// Imported here rather than at the top so the WalletConnect SDK stays
		// out of every other command's startup: this module is on the path of
		// balance, send, trade, aave and tx-status, and a static import made all
		// of them pay for it.
		const { createWalletConnectProvider } = await import("../walletconnect/provider.js");

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
		account: withPolicy(account, chain),
		chain: chain.viemChain,
		transport: http(chain.rpcUrl),
	});
}
