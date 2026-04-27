import { getChainConfig } from "../../services/chain/constants.js";
import { resolveToken } from "../../services/fibrous/tokens.js";
import { getRouteAndCallData } from "../../services/fibrous/route.js";
import { DEFAULT_SLIPPAGE } from "../../lib/config.js";
import { validateAmount } from "../../lib/validation.js";
import { parseAmount, formatAmount } from "../../lib/parseAmount.js";
import {
	createSpinner,
	outputResult,
	formatError,
	type OutputOptions,
	type GlobalOptions,
} from "../../lib/format.js";
import chalk from "chalk";
import { MINT } from "../../lib/brand.js";

// Dummy destination for route queries — does not affect route calculation
const QUOTE_DESTINATION = "0x0000000000000000000000000000000000000001";

interface QuoteOptions extends OutputOptions {
	slippage: number;
}

export async function quoteCommand(
	amount: string,
	from: string,
	to: string,
	opts: QuoteOptions
): Promise<void> {
	const spinner = createSpinner("Fetching quote...").start();

	try {
		validateAmount(amount);

		if (from.toLowerCase() === to.toLowerCase()) {
			throw new Error("Source and destination tokens cannot be the same.");
		}

		const globalOpts = opts as unknown as GlobalOptions;
		const chainName = globalOpts.chain || "base";
		const chain = getChainConfig(chainName);

		spinner.text = `Resolving tokens on ${chain.name}...`;
		const [tokenIn, tokenOut] = await Promise.all([
			resolveToken(from, chain),
			resolveToken(to, chain),
		]);

		const amountBaseUnits = parseAmount(amount, tokenIn.decimals);
		const isNativeInput =
			tokenIn.address.toLowerCase() === chain.nativeTokenAddress.toLowerCase();
		const isNativeOutput =
			tokenOut.address.toLowerCase() === chain.nativeTokenAddress.toLowerCase();
		const isWrappedInput =
			tokenIn.address.toLowerCase() === chain.wrappedNativeAddress.toLowerCase();
		const isWrappedOutput =
			tokenOut.address.toLowerCase() === chain.wrappedNativeAddress.toLowerCase();

		// Wrap: native → wrapped (1:1 rate, no route needed)
		if (isNativeInput && isWrappedOutput) {
			spinner.succeed("Quote ready");
			outputResult(
				{
					input: `${amount} ${tokenIn.symbol}`,
					output: `${amount} ${tokenOut.symbol}`,
					rate: `1 ${tokenIn.symbol} = 1 ${tokenOut.symbol}`,
					operation: "Wrap (direct contract call)",
					chain: chain.name,
				},
				opts
			);
			printCta(amount, from, to, opts);
			return;
		}

		// Unwrap: wrapped → native (1:1 rate, no route needed)
		if (isWrappedInput && isNativeOutput) {
			spinner.succeed("Quote ready");
			outputResult(
				{
					input: `${amount} ${tokenIn.symbol}`,
					output: `${amount} ${tokenOut.symbol}`,
					rate: `1 ${tokenIn.symbol} = 1 ${tokenOut.symbol}`,
					operation: "Unwrap (direct contract call)",
					chain: chain.name,
				},
				opts
			);
			printCta(amount, from, to, opts);
			return;
		}

		// Standard swap — fetch route from Fibrous
		spinner.text = "Finding best route...";
		const routeData = await getRouteAndCallData(
			{
				amount: amountBaseUnits.toString(),
				tokenInAddress: tokenIn.address,
				tokenOutAddress: tokenOut.address,
				slippage: opts.slippage ?? DEFAULT_SLIPPAGE,
				destination: QUOTE_DESTINATION,
			},
			chain
		);

		const outputAmount = formatAmount(BigInt(routeData.route.outputAmount), tokenOut.decimals);

		// Calculate exchange rate
		const inputNum = parseFloat(amount);
		const outputNum = parseFloat(outputAmount);
		const rate = inputNum > 0 ? (outputNum / inputNum).toFixed(4) : "N/A";

		spinner.succeed("Quote ready");
		outputResult(
			{
				input: `${amount} ${tokenIn.symbol}`,
				output: `~${outputAmount} ${tokenOut.symbol}`,
				rate: `1 ${tokenIn.symbol} ≈ ${rate} ${tokenOut.symbol}`,
				slippage: `${opts.slippage ?? DEFAULT_SLIPPAGE}%`,
				router: routeData.router_address,
				chain: chain.name,
			},
			opts
		);
		printCta(amount, from, to, opts);
	} catch (error) {
		spinner.fail("Quote failed");
		console.error(formatError(error));
		process.exitCode = 1;
	}
}

function printCta(amount: string, from: string, to: string, opts: OutputOptions): void {
	if (!opts.json) {
		console.log(
			`\n  ${chalk.dim("→ To execute:")} ${chalk.hex(MINT)(`fibx trade ${amount} ${from} ${to}`)}\n`
		);
	}
}
