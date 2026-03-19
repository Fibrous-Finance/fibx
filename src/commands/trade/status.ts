import { loadSession } from "../../services/auth/session.js";
import { checkHealth } from "../../services/fibrous/health.js";
import { getChainConfig } from "../../services/chain/constants.js";
import {
	outputResult,
	outputError,
	withSpinner,
	type OutputOptions,
	type GlobalOptions,
} from "../../lib/format.js";

export async function statusCommand(opts: OutputOptions): Promise<void> {
	try {
		const globalOpts = opts as unknown as GlobalOptions;
		const chainName = globalOpts.chain || "base";
		const chain = getChainConfig(chainName);
		const session = loadSession();

		const fibrousHealth = await withSpinner(
			"Checking Fibrous API...",
			async () => {
				try {
					const health = await checkHealth(chain);
					return { ok: true, message: health.message };
				} catch {
					return { ok: false, message: "unreachable" };
				}
			},
			opts
		);

		outputResult(
			{
				chain: chain.name,
				chainId: chain.id,
				authenticated: !!session,
				wallet: session?.walletAddress ?? null,
				fibrous: fibrousHealth,
			},
			opts
		);
	} catch (error) {
		outputError(error, opts);
	}
}
