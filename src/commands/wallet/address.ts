import { requireSession } from "../../services/auth/session.js";
import { outputResult, formatError, type OutputOptions } from "../../lib/format.js";

export async function addressCommand(opts: OutputOptions): Promise<void> {
	try {
		const session = requireSession();

		outputResult(
			{
				address: session.walletAddress,
				walletId: session.walletId ?? "N/A",
			},
			opts
		);
	} catch (error) {
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
