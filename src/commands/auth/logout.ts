import { Command } from "commander";
import { clearSession } from "../../services/auth/session.js";
import ora from "ora";

export const logoutCommand = new Command("logout")
	.description("Log out and clear current session")
	.action(async () => {
		const spinner = ora("Logging out...").start();
		try {
			clearSession();
			spinner.succeed("Logged out successfully. Session cleared.");
		} catch (error) {
			spinner.fail("Logout failed.");
			if (error instanceof Error) {
				console.error(error.message);
			}
		}
	});
