import { Command } from "commander";
import { clearSession, loadSession } from "../../services/auth/session.js";
import { runCommand } from "../../lib/cli-helpers.js";

export const logoutCommand = new Command("logout")
	.description("Log out and clear current session")
	.action(async () => {
		await runCommand(
			"Logging out...",
			"Logged out. Session cleared.",
			"Logout failed",
			async () => {
				const session = loadSession();
				try {
					if (session?.type === "walletconnect") {
						// Clearing session.json alone would leave the wallet
						// listing FibX as an active connection, with the
						// pairing keys still on disk. Dynamic import so the
						// WalletConnect SDK stays out of a Privy or
						// private-key logout.
						const { endWalletConnectSession } =
							await import("../../services/walletconnect/connect.js");
						await endWalletConnectSession(session.wcTopic);
					}
				} finally {
					// The user asked to leave. Whatever became of the wallet's
					// side, the local session goes — a teardown problem is
					// still reported, but it never leaves them logged in.
					clearSession();
				}
			},
			() => {}
		);
	});
