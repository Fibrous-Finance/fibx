import { randomUUID } from "node:crypto";
import { clearSession, loadSession, saveSession } from "../../services/auth/session.js";
import { releaseWalletConnectSession } from "../../services/auth/release.js";
import { getChainConfig, SUPPORTED_CHAINS } from "../../services/chain/constants.js";
import { checkHealth } from "../../services/fibrous/health.js";
import { createPairing } from "../../services/walletconnect/connect.js";
import { renderQrDataUri } from "../../services/walletconnect/qr.js";
import { jsonResult } from "./utils.js";

export async function handleGetAuthStatus({ chain }: { chain: string }) {
	const session = loadSession();
	const chainConfig = getChainConfig(chain);

	let fibrousStatus = "unreachable";
	try {
		const health = await checkHealth(chainConfig);
		fibrousStatus = health.message;
	} catch {
		fibrousStatus = "unreachable";
	}

	if (!session) {
		return jsonResult({
			authenticated: false,
			walletAddress: null,
			sessionType: null,
			authType: null,
			requiresApprovalPerTransaction: false,
			chain: chainConfig.name,
			fibrousStatus,
		});
	}

	return jsonResult({
		authenticated: true,
		walletAddress: session.walletAddress,
		sessionType: session.type,
		authType: session.type,
		requiresApprovalPerTransaction: session.type === "walletconnect",
		chain: chainConfig.name,
		fibrousStatus,
	});
}

export async function handleConfigAction({
	action,
	chain,
	url,
}: {
	action: "set-rpc" | "get-rpc" | "reset-rpc" | "list";
	chain?: string;
	url?: string;
}) {
	const { configService } = await import("../../services/config/config.js");

	if (action === "list") {
		const config = configService.getConfig();
		return jsonResult({ action, rpcUrls: config.rpcUrls });
	}

	if (action === "reset-rpc") {
		if (chain) {
			if (!SUPPORTED_CHAINS[chain]) {
				throw new Error(
					`Unsupported chain: ${chain}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`
				);
			}
			configService.resetRpcUrl(chain);
			return jsonResult({ action, chain, url: SUPPORTED_CHAINS[chain]?.rpcUrl });
		}
		configService.resetAll();
		return jsonResult({ action, rpcUrls: {} });
	}

	if (!chain) throw new Error("Chain is required for this action.");
	if (!SUPPORTED_CHAINS[chain]) {
		throw new Error(
			`Unsupported chain: ${chain}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`
		);
	}

	if (action === "get-rpc") {
		const customUrl = configService.getRpcUrl(chain);
		const defaultUrl = SUPPORTED_CHAINS[chain]?.rpcUrl;
		return jsonResult({ action, chain, url: customUrl || defaultUrl });
	}

	if (!url) throw new Error("URL is required for set-rpc.");
	try {
		new URL(url);
	} catch {
		throw new Error("Invalid URL format.");
	}

	configService.setRpcUrl(chain, url);
	return jsonResult({ action, chain, url });
}

type PairingState =
	| { status: "pending" }
	| { status: "connected"; address: string }
	| { status: "failed"; error: string };

/**
 * What a caller can observe. Derived from PairingState so a new state cannot be
 * added without appearing here; "unknown" is not a state a pairing reaches, it
 * is this process not holding the id at all.
 */
type ConnectStatus = PairingState["status"] | "unknown";

/**
 * Pending pairings, keyed by an id handed back to the caller. The MCP server is
 * one long-lived process, so this needs no persistence — and a pairing that
 * outlives the process is not resumable anyway.
 */
const pairings = new Map<string, PairingState>();

export async function handleConnectWallet(): Promise<{
	uri: string;
	qrDataUri: string;
	pairingId: string;
}> {
	// Before the new pairing, not after: teardown destroys the whole pairing
	// store, so running it once this call's own pairing exists would take the
	// new keys with it. Pairing again otherwise leaves the previous session
	// live in the user's wallet — mirrors src/commands/auth/connect.ts.
	await releaseWalletConnectSession();

	const { uri, approval } = await createPairing();
	const pairingId = randomUUID();
	pairings.set(pairingId, { status: "pending" });

	// Resolve in the background: an MCP tool call must not block for as long as
	// someone takes to find their phone.
	void approval()
		.then((session) => {
			saveSession({
				walletAddress: session.address,
				createdAt: new Date().toISOString(),
				type: "walletconnect",
				wcTopic: session.topic,
			});
			pairings.set(pairingId, { status: "connected", address: session.address });
		})
		.catch((error: unknown) => {
			pairings.set(pairingId, {
				status: "failed",
				error: error instanceof Error ? error.message : String(error),
			});
		});

	return { uri, qrDataUri: await renderQrDataUri(uri), pairingId };
}

export async function handleGetConnectStatus({
	pairingId,
}: {
	pairingId: string;
}): Promise<{ status: ConnectStatus; address?: string; error?: string }> {
	const state = pairings.get(pairingId);
	if (!state) return { status: "unknown" };
	return { ...state };
}

export async function handleLogout() {
	try {
		await releaseWalletConnectSession();
	} finally {
		// The user asked to leave. Whatever became of the wallet's side, the
		// local session goes — a teardown problem is still reported, but it
		// never leaves them logged in.
		clearSession();
	}
	return jsonResult({ ok: true, message: "Logged out. Session cleared." });
}
