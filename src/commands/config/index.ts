import type { Command } from "commander";
import chalk from "chalk";
import { configService } from "../../services/config/config.js";
import { SUPPORTED_CHAINS } from "../../services/chain/constants.js";
import { success, warn, formatError } from "../../lib/format.js";
import { BLUE } from "../../lib/brand.js";

export function registerConfigCommands(program: Command) {
	const configCmd = program
		.command("config")
		.description("Manage fibx configuration (RPC URLs, etc.)");

	configCmd
		.command("set-rpc")
		.description("Set a custom RPC URL for a specific chain")
		.argument("<chain>", "Chain name (base, citrea, hyperevm, monad)")
		.argument("<url>", "RPC URL")
		.addHelpText(
			"after",
			"\nExamples:\n  $ fibx config set-rpc base https://my-rpc.example.com\n  $ fibx config set-rpc monad https://rpc.monad.xyz"
		)
		.action((chain, url) => {
			if (!SUPPORTED_CHAINS[chain]) {
				console.error(formatError(new Error(`Unsupported chain: ${chain}`)));
				console.log(
					chalk.gray(`Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`)
				);
				process.exit(1);
			}

			try {
				new URL(url); // Validate URL format
			} catch {
				console.error(formatError(new Error("Invalid URL format.")));
				process.exit(1);
			}

			configService.setRpcUrl(chain, url);
			console.log(success(`Updated RPC for ${chain} to: ${url}`));
		});

	configCmd
		.command("get-rpc")
		.description("Get the current RPC URL for a chain")
		.argument("<chain>", "Chain name")
		.action((chain) => {
			const customUrl = configService.getRpcUrl(chain);
			const defaultUrl = SUPPORTED_CHAINS[chain]?.rpcUrl;

			if (!defaultUrl) {
				console.error(formatError(new Error(`Unsupported chain: ${chain}`)));
				process.exit(1);
			}

			if (customUrl) {
				console.log(chalk.bold("Current (Custom):"), chalk.hex(BLUE)(customUrl));
				console.log(chalk.gray("Default:"), chalk.dim(defaultUrl));
			} else {
				console.log(chalk.bold("Current (Default):"), defaultUrl);
			}
		});

	configCmd
		.command("list")
		.description("List all configuration")
		.action(() => {
			const config = configService.getConfig();
			console.log(chalk.bold.hex(BLUE)("\n  Custom RPCs"));
			if (Object.keys(config.rpcUrls).length === 0) {
				console.log(chalk.gray("  (None set)"));
			} else {
				for (const [chain, url] of Object.entries(config.rpcUrls)) {
					console.log(`    ${chalk.white(chain.padEnd(12))} ${chalk.hex(BLUE)(url)}`);
				}
			}
			console.log("");
		});

	configCmd
		.command("reset-rpc")
		.description("Reset custom RPC URL(s) to default")
		.argument("[chain]", "Chain name (omit to reset all)")
		.action((chain?: string) => {
			if (chain) {
				if (!SUPPORTED_CHAINS[chain]) {
					console.error(formatError(new Error(`Unsupported chain: ${chain}`)));
					console.log(
						chalk.gray(`Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`)
					);
					process.exit(1);
				}

				const currentUrl = configService.getRpcUrl(chain);
				if (!currentUrl) {
					console.log(
						warn(`No custom RPC set for ${chain}. Already using default.`)
					);
					return;
				}

				configService.resetRpcUrl(chain);
				console.log(success(`Reset RPC for ${chain} to default.`));
			} else {
				const config = configService.getConfig();
				if (Object.keys(config.rpcUrls).length === 0) {
					console.log(warn("No custom RPCs set. Already using defaults."));
					return;
				}

				configService.resetAll();
				console.log(success("All custom RPC URLs have been reset to defaults."));
			}
		});
}
