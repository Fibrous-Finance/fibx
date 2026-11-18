import { loadSession } from "../../services/auth/session.js";
import { checkHealth } from "../../services/fibrous/health.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { outputResult, type OutputOptions, type GlobalOptions } from "../../lib/format.js";
import { runCommand } from "../../lib/cli-helpers.js";

export async function statusCommand(opts: OutputOptions): Promise<void> {
	await runCommand(
		"Checking status...",
		"Status check complete",
		"Status check failed",
		async (spinner) => {
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

			return {
				chain: chain.name,
				chainId: chain.id,
				authenticated: !!session,
				wallet: session?.walletAddress ?? "N/A",
				fibrous: fibrousHealth.ok ? "✓ healthy" : "✗ unreachable",
			};
		},
		(data) => outputResult(data, opts),
		opts
	);
}
