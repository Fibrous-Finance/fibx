import { loadSession } from "../../services/auth/session.js";
import { outputResult, formatError, type OutputOptions } from "../../lib/format.js";

export async function walletsCommand(opts: OutputOptions): Promise<void> {
	try {
		const session = loadSession();

		if (!session) {
			outputResult(
				{ message: "No active session. Run `fibx auth login <email>` first." },
				opts
			);
			return;
		}

		outputResult(
			{
				address: session.walletAddress,
				walletId: session.walletId ?? "N/A",
				type: session.type,
				createdAt: session.createdAt,
			},
			opts
		);
	} catch (error) {
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
