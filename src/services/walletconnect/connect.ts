import type { SessionTypes } from "@walletconnect/types";
import { getSdkError } from "@walletconnect/utils";
import { getSignClient, walletConnectStore } from "./client.js";
import { buildOptionalNamespaces, firstAccountAddress } from "./namespaces.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

export interface PairedSession {
	topic: string;
	address: string;
}

export async function createPairing(): Promise<{
	uri: string;
	approval: () => Promise<PairedSession>;
}> {
	const signClient = await getSignClient();

	// The proposal itself can fail before a URI exists — the relay may be
	// unreachable. Left unwrapped, that raw SDK error escapes the FibxError
	// contract every other path here honours, and both the CLI formatter and
	// the MCP error handler fall back to UNKNOWN_ERROR.
	let uri: string | undefined;
	let approval: () => Promise<SessionTypes.Struct>;
	try {
		({ uri, approval } = await signClient.connect({
			optionalNamespaces: buildOptionalNamespaces(),
		}));
	} catch (error) {
		throw new FibxError(
			ErrorCode.WALLET_ERROR,
			`Could not open a WalletConnect pairing: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}

	if (!uri) {
		throw new FibxError(
			ErrorCode.WALLET_ERROR,
			"WalletConnect returned no pairing URI. Try again."
		);
	}

	return {
		uri,
		approval: async () => {
			let session: SessionTypes.Struct;
			try {
				session = await approval();
			} catch (error) {
				// Rejection and timeout arrive the same way; the wallet's own
				// message is the most useful thing to show.
				throw new FibxError(
					ErrorCode.WALLET_ERROR,
					`Wallet did not approve the connection: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}

			const address = firstAccountAddress(session.namespaces);
			if (!address) {
				throw new FibxError(
					ErrorCode.WALLET_ERROR,
					"Wallet approved the connection but shared no account."
				);
			}

			return { topic: session.topic, address };
		},
	};
}

/**
 * Ends the wallet's side of the pairing and removes the key material.
 *
 * Deleting session.json alone is not a logout: the wallet would keep listing
 * FibX as an active connection, and the symmetric keys authorising it would
 * stay in the config directory indefinitely.
 *
 * Best-effort on purpose. The user asked to leave, so an unreachable relay or a
 * session the wallet has already dropped must not keep them logged in — and the
 * local key material is removed either way, which is the half that matters if
 * only one can be done.
 */
/** How long a logout waits for the wallet's side to be told before giving up. */
const DISCONNECT_TIMEOUT_MS = 3_000;

/**
 * Rejects if `work` has not settled within `ms`.
 *
 * The timer is unref'd so a pending one can never be the handle that keeps the
 * CLI alive — this module already had to learn that lesson once, with the relay
 * heartbeat.
 */
function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("timed out")), ms);
		timer.unref?.();

		work.then(
			() => {
				clearTimeout(timer);
				resolve();
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		);
	});
}

export async function endWalletConnectSession(topic?: string): Promise<void> {
	if (topic) {
		try {
			const signClient = await getSignClient();
			// A rejection would be caught below, but a stall is not a rejection:
			// disconnect() reaches Relayer.connect(), which retries five times
			// with 15s timeouts plus backoff. A reachable-but-blackholed relay
			// would hold the terminal for minutes after the user asked to leave.
			await withTimeout(
				signClient.disconnect({ topic, reason: getSdkError("USER_DISCONNECTED") }),
				DISCONNECT_TIMEOUT_MS
			);
		} catch {
			// Already gone, unreachable, or too slow. None of them blocks a logout.
		}
	}

	// After the disconnect, so SignClient's own write to the store cannot
	// recreate what this removes.
	try {
		walletConnectStore().destroy();
	} catch {
		// A store we cannot delete is worth reporting no more loudly than this:
		// the session is going regardless.
	}
}

export async function getActiveSession(topic: string): Promise<SessionTypes.Struct> {
	const signClient = await getSignClient();
	try {
		return signClient.session.get(topic);
	} catch {
		throw new FibxError(
			ErrorCode.SESSION_EXPIRED,
			"WalletConnect session is no longer active. Run `fibx auth connect` to pair again."
		);
	}
}
