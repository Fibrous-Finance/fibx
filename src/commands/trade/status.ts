import { loadSession } from "../../services/auth/session.js";
import { checkHealth } from "../../services/fibrous/health.js";
import { getChainConfig } from "../../services/chain/constants.js";
import {
	createSpinner,
	outputResult,
	formatError,
	type OutputOptions,
	type GlobalOptions,
} from "../../lib/format.js";

export async function statusCommand(opts: OutputOptions): Promise<void> {
	const spinner = createSpinner("Checking status...").start();

	try {
		const globalOpts = opts as unknown as GlobalOptions;
		const chainName = globalOpts.chain || "base";
		const chain = getChainConfig(chainName);
		const session = loadSession();

		spinner.text = "Checking Fibrous API...";
		let fibrousHealth: { ok: boolean; message: string };
		try {
			const health = await checkHealth(chain);
			fibrousHealth = { ok: true, message: health.message };
		} catch {
			fibrousHealth = { ok: false, message: "unreachable" };
		}

		spinner.succeed("Status check complete");

		outputResult(
			{
				chain: chain.name,
				chainId: chain.id,
				authenticated: !!session,
				wallet: session?.walletAddress ?? "N/A",
				fibrous: fibrousHealth.ok ? "✓ healthy" : "✗ unreachable",
			},
			opts
		);
	} catch (error) {
		spinner.fail("Status check failed");
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
