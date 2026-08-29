import { loadSession } from "./session.js";

/**
 * Ends any live WalletConnect pairing before the session is replaced.
 *
 * Clearing session.json alone leaves the wallet listing FibX as an active
 * connection with the pairing keys still on disk. `logout` closed that gap;
 * every other path that replaces a session had it too — `auth login`,
 * `auth import`, and a second `auth connect`.
 *
 * Callers must run this BEFORE establishing the replacement. Teardown destroys
 * the whole pairing store, so running it once a new pairing exists would take
 * the new keys with it.
 *
 * The import is dynamic so a Privy or private-key path never loads the
 * WalletConnect SDK.
 */
export async function releaseWalletConnectSession(): Promise<void> {
	const session = loadSession();
	if (session?.type !== "walletconnect") return;

	const { endWalletConnectSession } = await import("../walletconnect/connect.js");
	await endWalletConnectSession(session.wcTopic);
}
