import chalk from "chalk";
import { getPortfolio, type Portfolio } from "../../services/portfolio/portfolio.js";
import {
	createSpinner,
	formatResult,
	formatTable,
	formatError,
	type OutputOptions,
} from "../../lib/format.js";
import { MINT } from "../../lib/brand.js";

function formatUsd(value: number): string {
	return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function printPortfolio(portfolio: Portfolio): void {
	const shortAddr = `${portfolio.wallet.slice(0, 6)}...${portfolio.wallet.slice(-4)}`;
	console.log();
	console.log(chalk.bold.hex(MINT)(`  Portfolio — ${shortAddr}`));
	console.log(chalk.dim("  " + "═".repeat(52)));

	for (const chain of portfolio.chains) {
		if (chain.assets.length === 0) continue;

		console.log();
		console.log(chalk.bold.white(`  ${chain.chain}`));

		console.log(
			formatTable(
				["Token", "Balance", "USD Value"],
				chain.assets.map((asset) => [
					asset.symbol,
					parseFloat(asset.balance).toFixed(4),
					formatUsd(asset.usdValue),
				])
			)
		);
	}

	if (portfolio.defi.length > 0) {
		for (const pos of portfolio.defi) {
			console.log();
			console.log(chalk.bold.white(`  DeFi — ${pos.protocol} (${pos.chain})`));

			const hf = parseFloat(pos.healthFactor);
			const hfStr = hf > 100 ? "Safe (>100)" : hf.toFixed(2);
			const hfColor = hf > 2 ? chalk.green : hf > 1.2 ? chalk.yellow : chalk.red;

			console.log(
				formatResult({
					collateral: formatUsd(pos.collateralUsd),
					debt: `-${formatUsd(pos.debtUsd)}`,
					healthFactor: hfColor(hfStr),
					netPosition: formatUsd(pos.netUsd),
				})
			);
		}
	}

	console.log();
	console.log(chalk.dim("  " + "═".repeat(52)));
	console.log(
		formatResult({
			totalPortfolioUsd: chalk.bold.hex(MINT)(formatUsd(portfolio.totalUsd)),
		})
	);
	console.log();
}

export async function portfolioCommand(opts: OutputOptions): Promise<void> {
	const spinner = createSpinner("Fetching portfolio across all chains...").start();

	try {
		const portfolio = await getPortfolio();

		spinner.succeed("Portfolio loaded");

		if (opts.json) {
			console.log(JSON.stringify(portfolio, null, 2));
		} else {
			printPortfolio(portfolio);
		}
	} catch (error) {
		spinner.fail("Failed to load portfolio");
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
