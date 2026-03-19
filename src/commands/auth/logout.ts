import { Command } from "commander";
import { clearSession } from "../../services/auth/session.js";
import { createSpinner, formatError } from "../../lib/format.js";

export const logoutCommand = new Command("logout")
	.description("Log out and clear current session")
	.action(async () => {
		const spinner = createSpinner("Logging out...").start();
		try {
			clearSession();
			spinner.succeed("Logged out. Session cleared.");
		} catch (error) {
			spinner.fail("Logout failed");
			console.error(formatError(error));
		}
	});
