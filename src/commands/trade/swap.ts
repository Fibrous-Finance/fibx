import { formatUnits } from "viem";
import {
	executeSwap,
	SwapSimulationError,
	type SwapOutcome,
	type SwapProgress,
} from "../../services/trade/swap.js";
import { getPublicClient } from "../../services/chain/client.js";
import { waitForSuccess } from "../../services/chain/receipt.js";
import { DEFAULT_SLIPPAGE } from "../../lib/config.js";
import {
	createSpinner,
	outputResult,
	outputError,
	type OutputOptions,
	type GlobalOptions,
} from "../../lib/format.js";

interface TradeOptions extends OutputOptions {
	slippage: number;
	approveMax?: boolean;
	simulate?: boolean;
}

type Spinner = ReturnType<typeof createSpinner>;

const SIMULATION = "SIMULATION (no TX sent)";

export async function tradeCommand(
	amount: string,
	from: string,
	to: string,
	opts: TradeOptions
): Promise<void> {
	const spinner = createSpinner("Resolving tokens...").start();
	// The step in flight, so a failure stops the spinner that is actually
	// turning rather than leaving it running under the error.
	let step = null as Spinner | null;

	const onProgress = (event: SwapProgress) => {
		switch (event.stage) {
			case "resolving":
				spinner.text = `Resolving tokens on ${event.chain.name}...`;
				break;
			case "wrapping":
			case "unwrapping":
				spinner.text = `${event.stage === "wrapping" ? "Wrapping" : "Unwrapping"} ${amount} ${event.tokenIn.symbol} → ${event.tokenOut.symbol}...`;
				break;
			case "routing":
				spinner.text = "Finding best route...";
				break;
			case "routed":
				if (!opts.json) {
					spinner.stop();
					console.log(
						`\n  Route: ${amount} ${event.tokenIn.symbol} → ~${event.amountOut} ${event.tokenOut.symbol}`
					);
					console.log(`  Slippage: ${event.slippage}%\n`);
				}
				break;
			case "approving":
				step = createSpinner("Approving token spend...").start();
				break;
			case "approval-sent":
				if (step) step.text = "Waiting for approval confirmation...";
				break;
			case "approved":
				step?.succeed("Token approved");
				step = null;
				break;
			case "swapping":
				step = createSpinner(
					`Swapping ${amount} ${event.tokenIn.symbol} → ${event.tokenOut.symbol}...`
				).start();
				break;
		}
	};

	try {
		const globalOpts = opts as unknown as GlobalOptions;
		const outcome = await executeSwap({
			amount,
			from,
			to,
			chain: globalOpts.chain || "base",
			slippage: opts.slippage ?? DEFAULT_SLIPPAGE,
			simulate: opts.simulate,
			approveMax: opts.approveMax,
			quoteFee: true,
			onProgress,
		});

		const done: Spinner = step ?? spinner;
		if (outcome.simulated) {
			done.succeed("Simulation complete");
		} else {
			// "confirmed" is a claim about the chain, so it waits for the receipt
			// and fails on a revert; swap_tokens returns the hash at once and
			// leaves the polling to get_tx_status.
			const label =
				outcome.operation === "wrap"
					? "Wrap"
					: outcome.operation === "unwrap"
						? "Unwrap"
						: "Swap";
			done.text = `Waiting for ${outcome.hash} to confirm...`;
			await waitForSuccess(getPublicClient(outcome.chain), outcome.hash, label);
			done.succeed(`${label} confirmed`);
		}
		outputResult(formatOutcome(outcome), opts);
	} catch (error) {
		if (error instanceof SwapSimulationError) step?.fail("Simulation failed");
		else step?.stop();
		spinner.fail("Swap failed");
		outputError(error, opts);
	}
}

/**
 * `estimatedGas` here is a fee in the chain's native token (gas × gas price),
 * where the `swap_tokens` tool reports gas units — each surface keeps the unit
 * it has always printed.
 */
function formatOutcome(outcome: SwapOutcome): Record<string, unknown> {
	const { chain, tokenIn, tokenOut, amountIn, amountOut } = outcome;
	const input = `${amountIn} ${tokenIn.symbol}`;
	const fee =
		outcome.simulated && outcome.feeWei !== undefined
			? { estimatedGas: `${formatUnits(outcome.feeWei, 18)} ${chain.nativeSymbol}` }
			: {};

	if (outcome.operation !== "swap") {
		const action = outcome.operation === "wrap" ? "Wrap" : "Unwrap";
		const output = `${amountOut} ${tokenOut.symbol}`;
		if (outcome.simulated) {
			return { mode: SIMULATION, action, input, output, ...fee, chain: chain.name };
		}
		return {
			action,
			input,
			output,
			txHash: outcome.hash,
			...(outcome.explorer ? { explorer: outcome.explorer } : {}),
			chain: chain.name,
		};
	}

	const output = `~${amountOut} ${tokenOut.symbol}`;
	if (outcome.simulated) {
		return {
			mode: SIMULATION,
			input,
			output,
			...fee,
			requiresApproval: outcome.requiresApproval,
			router: outcome.router,
			chain: chain.name,
		};
	}
	return {
		input,
		output,
		txHash: outcome.hash,
		...(outcome.explorer ? { explorer: outcome.explorer } : {}),
		router: outcome.router,
		chain: chain.name,
	};
}
