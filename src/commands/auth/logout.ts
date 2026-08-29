import { Command } from "commander";
import { clearSession } from "../../services/auth/session.js";
import { releaseWalletConnectSession } from "../../services/auth/release.js";
import { runCommand } from "../../lib/cli-helpers.js";

export const logoutCommand = new Command("logout")
	.description("Log out and clear current session")
	.action(async () => {
		await runCommand(
			"Logging out...",
			"Logged out. Session cleared.",
			"Logout failed",
			async () => {
				try {
					await releaseWalletConnectSession();
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
