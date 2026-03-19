#!/usr/bin/env node

import { createRequire } from "node:module";
import { Command, type Help } from "commander";
import chalk from "chalk";
import { outputError } from "./lib/format.js";
import { BLUE, MINT, LOGO_ROW_COLORS } from "./lib/brand.js";
import { statusCommand } from "./commands/trade/status.js";
import { authLoginCommand } from "./commands/auth/login.js";
import { authVerifyCommand } from "./commands/auth/verify.js";
import { addressCommand } from "./commands/wallet/address.js";
import { balanceCommand } from "./commands/wallet/balance.js";
import { sendCommand } from "./commands/wallet/send.js";
import { tradeCommand } from "./commands/trade/swap.js";
import { walletsCommand } from "./commands/wallet/list.js";
import { txStatusCommand } from "./commands/chain/transaction.js";
import { aaveCommand } from "./commands/defi/aave.js";
import { registerConfigCommands } from "./commands/config/index.js";
import { logoutCommand } from "./commands/auth/logout.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

// ── ASCII Logo ───────────────────────────────────────────────────────

const LOGO_LINES = [
	"  ███████╗██╗██████╗ ██╗  ██╗",
	"  ██╔════╝██║██╔══██╗╚██╗██╔╝",
	"  █████╗  ██║██████╔╝ ╚███╔╝ ",
	"  ██╔══╝  ██║██╔══██╗ ██╔██╗ ",
	"  ██║     ██║██████╔╝██╔╝ ██╗",
	"  ╚═╝     ╚═╝╚═════╝ ╚═╝  ╚═╝",
] as const;

const coloredLogo = LOGO_LINES.map((line, i) =>
	chalk.bold.hex(LOGO_ROW_COLORS[i] ?? MINT)(line)
).join("\n");

const tagline =
	chalk.dim("v") +
	chalk.hex(BLUE).bold(version) +
	chalk.dim("  ·  ") +
	chalk.white("Multi-Chain DeFi CLI + MCP Server");

const banner = `\n${coloredLogo}\n\n${tagline}\n`;

// ── Quick Start Footer ───────────────────────────────────────────────

const dim = chalk.dim.bind(chalk);
const white = chalk.white.bind(chalk);

const footer = `
${chalk.bold.hex(MINT)("Quick Start")}

  ${dim("$")} ${white("fibx auth login <email>")}              ${dim("# Sign in with Privy OTP")}
  ${dim("$")} ${white("fibx trade 0.1 ETH USDC")}              ${dim("# Best-price swap via Fibrous")}
  ${dim("$")} ${white("fibx balance")}                          ${dim("# View all token balances")}
  ${dim("$")} ${white("fibx aave supply 1 ETH")}                ${dim("# Supply to Aave V3")}
  ${dim("$")} ${white("fibx portfolio")}                        ${dim("# Cross-chain portfolio")}

  ${dim("Run")} ${white("fibx <command> --help")} ${dim("for detailed flags and examples.")}
  ${dim("Docs →")} ${chalk.hex(BLUE).underline("https://github.com/ahmetenesdur/fibx")}
`;

// ── Command Groups ───────────────────────────────────────────────────

const COMMAND_GROUPS: Record<string, string[]> = {
	Authentication: ["auth"],
	Wallet: ["address", "balance", "wallets", "send"],
	Trading: ["trade", "portfolio"],
	DeFi: ["aave"],
	System: ["status", "tx-status", "config", "mcp-start", "help"],
};

// ── Program Setup ────────────────────────────────────────────────────

const program = new Command();

program
	.name("fibx")
	.description("Multi-chain DeFi CLI + MCP Server. Powered by Fibrous.")
	.version(version)
	.showHelpAfterError()
	.addHelpText("beforeAll", banner);

program.configureHelp({
	formatHelp(cmd: Command, helper: Help): string {
		if (cmd.name() !== "fibx") {
			// Sub-command pages: clean styled layout
			const lines: string[] = [];
			const width = helper.padWidth(cmd, helper);

			const usage = helper.commandUsage(cmd);
			if (usage) lines.push(`${chalk.bold("Usage:")} ${usage}`, "");

			const desc = helper.commandDescription(cmd);
			if (desc) lines.push(desc, "");

			const args = helper.visibleArguments(cmd);
			if (args.length) {
				lines.push(chalk.bold("Arguments:"));
				for (const a of args) {
					lines.push(
						`  ${chalk.white(helper.argumentTerm(a).padEnd(width))}  ${chalk.dim(helper.argumentDescription(a))}`
					);
				}
				lines.push("");
			}

			const opts = helper.visibleOptions(cmd);
			if (opts.length) {
				lines.push(chalk.bold("Options:"));
				for (const o of opts) {
					lines.push(
						`  ${chalk.white(helper.optionTerm(o).padEnd(width))}  ${chalk.dim(helper.optionDescription(o))}`
					);
				}
				lines.push("");
			}

			const subs = helper.visibleCommands(cmd);
			if (subs.length) {
				lines.push(chalk.bold("Commands:"));
				for (const s of subs) {
					lines.push(
						`  ${chalk.white(helper.subcommandTerm(s).padEnd(width))}  ${chalk.dim(helper.subcommandDescription(s))}`
					);
				}
				lines.push("");
			}

			return lines.join("\n");
		}

		// Root command: grouped layout + Quick Start
		const lines: string[] = [];
		const width = helper.padWidth(cmd, helper);

		lines.push(
			`${chalk.bold("Usage:")} fibx ${chalk.dim("[command]")} ${chalk.dim("[options]")}`,
			""
		);

		const opts = helper.visibleOptions(cmd);
		if (opts.length) {
			lines.push(chalk.bold("Options:"));
			for (const o of opts) {
				lines.push(
					`  ${chalk.hex(BLUE)(helper.optionTerm(o).padEnd(width))}  ${chalk.dim(helper.optionDescription(o))}`
				);
			}
			lines.push("");
		}

		lines.push(chalk.bold("Commands:"));

		const allCmds = helper.visibleCommands(cmd);
		const cmdMap = new Map(allCmds.map((c) => [c.name(), c]));
		const rendered = new Set<string>();

		for (const [groupLabel, cmdNames] of Object.entries(COMMAND_GROUPS)) {
			const groupCmds = cmdNames
				.map((n) => cmdMap.get(n))
				.filter((c): c is Command => c !== undefined);

			if (groupCmds.length === 0) continue;

			lines.push(`\n  ${chalk.bold.hex(BLUE)(groupLabel)}`);
			for (const c of groupCmds) {
				lines.push(
					`    ${chalk.white(helper.subcommandTerm(c).padEnd(width))}  ${chalk.dim(helper.subcommandDescription(c))}`
				);
				rendered.add(c.name());
			}
		}

		// Catch-all for commands not listed in COMMAND_GROUPS
		const ungrouped = allCmds.filter((c) => !rendered.has(c.name()));
		if (ungrouped.length) {
			lines.push(`\n  ${chalk.bold("Other")}`);
			for (const c of ungrouped) {
				lines.push(
					`    ${chalk.white(helper.subcommandTerm(c).padEnd(width))}  ${chalk.dim(helper.subcommandDescription(c))}`
				);
			}
		}

		lines.push("", footer);
		return lines.join("\n");
	},
});

registerConfigCommands(program);
program
	.option("-c, --chain <chain>", "Chain to use (base, citrea, hyperevm, monad)", "base")
	.option("--json", "Output results as JSON", false)
	.showHelpAfterError();

// ── Auth Commands ────────────────────────────────────────────────────

const auth = program.command("auth").description("Authentication commands");

auth.command("login")
	.description("Initiate email OTP login via Privy")
	.argument("<email>", "Email address for OTP login")
	.addHelpText("after", "\nExamples:\n  $ fibx auth login user@example.com")
	.action(async (email, _opts, cmd) => {
		const globalOpts = cmd.parent!.parent!.opts();
		await authLoginCommand(email, { json: globalOpts.json });
	});

auth.command("verify")
	.description("Verify OTP code and create wallet session")
	.argument("<email>", "Email used for login")
	.argument("<code>", "OTP code from email")
	.addHelpText("after", "\nExamples:\n  $ fibx auth verify user@example.com 123456")
	.action(async (email, code, _opts, cmd) => {
		const globalOpts = cmd.parent!.parent!.opts();
		await authVerifyCommand(email, code, { json: globalOpts.json });
	});

auth.command("import")
	.description("Import a private key for local authentication")
	.addHelpText("after", "\nExamples:\n  $ fibx auth import")
	.action(async (_opts, cmd) => {
		const globalOpts = cmd.parent!.parent!.opts();
		const { authImportCommand } = await import("./commands/auth/import.js");
		await authImportCommand({ json: globalOpts.json });
	});

auth.addCommand(logoutCommand);

// ── System Commands ──────────────────────────────────────────────────

program
	.command("status")
	.description("Check auth status and Fibrous health")
	.addHelpText("after", "\nExamples:\n  $ fibx status\n  $ fibx status --chain monad")
	.action(async (_opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		await statusCommand({ ...globalOpts, json: globalOpts.json });
	});

program
	.command("tx-status")
	.description("Check transaction status and receipt")
	.argument("<hash>", "Transaction hash (0x...)")
	.addHelpText(
		"after",
		"\nExamples:\n  $ fibx tx-status 0xabc...def\n  $ fibx tx-status 0xabc...def --chain monad"
	)
	.action(async (hash, _opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		await txStatusCommand(hash, { ...globalOpts, json: globalOpts.json });
	});

// ── Wallet Commands ──────────────────────────────────────────────────

program
	.command("wallets")
	.description("List wallets linked to the active session")
	.action(async (_opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		await walletsCommand({ json: globalOpts.json });
	});

program
	.command("address")
	.description("Show active wallet address")
	.action(async (_opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		await addressCommand({ json: globalOpts.json });
	});

program
	.command("balance")
	.description("Show native token and ERC-20 balances")
	.addHelpText(
		"after",
		"\nExamples:\n  $ fibx balance\n  $ fibx balance --chain citrea\n  $ fibx balance --json"
	)
	.action(async (_opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		await balanceCommand({ ...globalOpts, json: globalOpts.json });
	});

program
	.command("send")
	.description("Send tokens (native or ERC-20)")
	.argument("<amount>", "Amount to send")
	.argument("<recipient>", "Recipient address (0x...)")
	.argument("[token]", "Token symbol or address (default: chain native token)")
	.option("--simulate", "Estimate gas without executing", false)
	.addHelpText(
		"after",
		"\nExamples:\n  $ fibx send 0.1 0xRecipient...\n  $ fibx send 100 0xRecipient... USDC\n  $ fibx send 0.5 0xRecipient... --chain monad"
	)
	.action(async (amount, recipient, token, opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		await sendCommand(amount, recipient, token, {
			...globalOpts,
			json: globalOpts.json,
			simulate: opts.simulate,
		});
	});

// ── Trading Commands ─────────────────────────────────────────────────

program
	.command("trade")
	.description("Swap tokens via Fibrous")
	.argument("<amount>", "Amount to swap")
	.argument("<from>", "Source token (symbol or address)")
	.argument("<to>", "Destination token (symbol or address)")
	.option("-s, --slippage <number>", "Slippage tolerance %", "0.5")
	.option("--approve-max", "Approve maximum amount instead of exact amount", false)
	.option("--simulate", "Estimate gas without executing", false)
	.addHelpText(
		"after",
		"\nExamples:\n  $ fibx trade 0.1 ETH USDC\n  $ fibx trade 100 USDC WETH --slippage 1\n  $ fibx trade 0.5 ETH DAI --chain base"
	)
	.action(async (amount, from, to, opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		await tradeCommand(amount, from, to, {
			...globalOpts,
			json: globalOpts.json,
			slippage: parseFloat(opts.slippage),
			approveMax: opts.approveMax,
			simulate: opts.simulate,
		});
	});

program
	.command("portfolio")
	.description("Show cross-chain portfolio with USD values")
	.addHelpText("after", "\nExamples:\n  $ fibx portfolio\n  $ fibx portfolio --json")
	.action(async (_opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		const { portfolioCommand } = await import("./commands/portfolio/index.js");
		await portfolioCommand({ json: !!globalOpts.json });
	});

// ── DeFi Commands ────────────────────────────────────────────────────

program
	.command("aave")
	.description("Aave V3 operations (Base only)")
	.argument("<action>", "Action: status, supply, borrow, repay, withdraw, markets")
	.argument("[amount]", "Amount (use 'max' for full repay/withdraw)")
	.argument("[token]", "Token symbol or address")
	.option("--simulate", "Estimate gas without executing", false)
	.addHelpText(
		"after",
		"\nExamples:\n  $ fibx aave status\n  $ fibx aave markets\n  $ fibx aave supply 1 ETH\n  $ fibx aave supply 1 ETH --simulate\n  $ fibx aave borrow 500 USDC\n  $ fibx aave repay max USDC\n  $ fibx aave withdraw max ETH"
	)
	.action(async (action, amount, token, opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		await aaveCommand(action, amount, token, {
			...globalOpts,
			json: globalOpts.json,
			simulate: opts.simulate,
		});
	});

// ── MCP Server ───────────────────────────────────────────────────────

program
	.command("mcp-start")
	.description("Start MCP (Model Context Protocol) server for AI agent integration")
	.addHelpText(
		"after",
		`
Notes:
  Communicates via stdin/stdout (stdio transport — standard MCP protocol).
  Add to your AI client config (Claude, Cursor, etc.):

    {
      "mcpServers": {
        "fibx": { "command": "fibx", "args": ["mcp-start"] }
      }
    }

  See MCP.md for the full integration guide.`
	)
	.action(async () => {
		const { startMcpServer } = await import("./mcp/server.js");
		await startMcpServer();
	});

program.parseAsync().catch((error: unknown) => {
	outputError(error, { json: !!program.opts().json });
});
