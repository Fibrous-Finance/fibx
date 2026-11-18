import { requireSession } from "../../services/auth/session.js";
import { outputResult, type OutputOptions } from "../../lib/format.js";
import { runCommand } from "../../lib/cli-helpers.js";

export async function addressCommand(opts: OutputOptions): Promise<void> {
	await runCommand(
		"Loading wallet...",
		"Wallet loaded",
		"Failed to load wallet",
		async () => {
			const session = requireSession();
			return {
				address: session.walletAddress,
				walletId: session.walletId ?? "N/A",
			};
		},
		(data) => outputResult(data, opts),
		opts
	);
}
