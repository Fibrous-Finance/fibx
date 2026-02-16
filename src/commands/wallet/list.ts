import { loadSession } from "../../services/auth/session.js";
import { outputResult, outputError, type OutputOptions } from "../../lib/format.js";

export async function walletsCommand(_email: string, opts: OutputOptions): Promise<void> {
	try {
		const session = loadSession();

		if (!session) {
			outputResult(
				{ message: "No active session. Run `fibx auth login <email>` first." },
				opts
			);
			return;
		}

		const walletInfo = {
			address: session.walletAddress,
			id: session.walletId ?? "N/A",
			type: session.type,
			createdAt: session.createdAt,
		};

		if (opts.json) {
			console.log(JSON.stringify([walletInfo], null, 2));
		} else {
			console.log("Active wallet:");
			console.log(`\nAddress: ${walletInfo.address}`);
			console.log(`ID:      ${walletInfo.id}`);
			console.log(`Type:    ${walletInfo.type}`);
			console.log(`Created: ${walletInfo.createdAt}`);
		}
	} catch (error) {
		outputError(error, opts);
	}
}
