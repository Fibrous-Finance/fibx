import { join } from "node:path";
import SignClient from "@walletconnect/sign-client";
import type { ISignClient } from "@walletconnect/types";
import { paths, getWcProjectId, WC_STORAGE_FILE } from "../../lib/config.js";
import { FileKeyValueStorage } from "./storage.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

let client: Promise<ISignClient> | null = null;

/**
 * SignClient's key-value store — symmetric keys, session topics, pairing
 * material — kept beside session.json at 0600 rather than in the working
 * directory. One place builds it so one place knows where it is.
 */
export function walletConnectStore(): FileKeyValueStorage {
	return new FileKeyValueStorage(join(paths.config, WC_STORAGE_FILE));
}

/**
 * One SignClient per process. Initialisation opens a relay connection, so
 * repeating it per command would pay that cost several times in a single run.
 */
export async function getSignClient(): Promise<ISignClient> {
	if (!client) {
		client = SignClient.init({
			projectId: getWcProjectId(),
			storage: walletConnectStore(),
			metadata: {
				name: "FibX",
				description: "DeFi CLI and MCP server powered by Fibrous aggregation",
				url: "https://docs.fibrous.finance/fibx-agent",
				icons: ["https://fibrous.finance/favicon.ico"],
			},
		}).catch((error: unknown) => {
			client = null; // let the next command retry rather than caching a failure
			throw new FibxError(
				ErrorCode.WALLET_ERROR,
				`Could not reach the WalletConnect relay: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		});
	}
	return client;
}

/**
 * Stops the heartbeat, closes the relay transport and clears the memo.
 * Idempotent, and a no-op when no client was ever opened — the CLI calls it
 * unconditionally on the way out.
 *
 * The heartbeat is not optional housekeeping. Core.initialize() calls
 * heartbeat.init() unconditionally, @walletconnect/heartbeat@1.2.2 registers a
 * plain setInterval with no unref(), and @walletconnect/core never calls
 * heartbeat.stop() anywhere. Closing the transport alone leaves that interval
 * running, so the command prints its result and then hangs forever.
 *
 * Deliberately not called from the pairing flow: the MCP server is long-lived
 * and must keep its session alive to sign with it.
 */
export async function closeSignClient(): Promise<void> {
	const pending = client;
	if (!pending) return;
	client = null;
	try {
		const signClient = await pending;
		signClient.core.heartbeat.stop();
		await signClient.core.relayer.transportClose();
	} catch {
		// Closing is best-effort — the process is exiting either way.
	}
}
