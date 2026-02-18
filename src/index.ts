#!/usr/bin/env node

import { Command } from "commander";
import { outputError } from "./lib/format.js";
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
import { logoutCommand } from "./commands/auth/logout.js";

const program = new Command();

program
	.name("fibx")
	.description("Fibrous DeFi CLI — wallet, transfer, swap")
	.version("0.3.5")
	.option("-c, --chain <chain>", "Chain to use (base, citrea, hyperevm, monad)", "base")
	.option("--json", "Output results as JSON", false)
	.showHelpAfterError();

const auth = program.command("auth").description("Authentication commands");

auth.command("login")
	.description("Initiate email OTP login via Privy")
	.argument("<email>", "Email address for OTP login")
	.action(async (email, _opts, cmd) => {
		const globalOpts = cmd.parent!.parent!.opts();
		await authLoginCommand(email, { json: globalOpts.json });
	});

auth.command("verify")
	.description("Verify OTP code and create wallet session")
	.argument("<email>", "Email used for login")
	.argument("<code>", "OTP code from email")
	.action(async (email, code, _opts, cmd) => {
		const globalOpts = cmd.parent!.parent!.opts();
		await authVerifyCommand(email, code, { json: globalOpts.json });
	});

auth.command("import")
	.description("Import a private key for local authentication")
	.action(async (_opts, cmd) => {
		const globalOpts = cmd.parent!.parent!.opts();
		const { authImportCommand } = await import("./commands/auth/import.js");
		await authImportCommand({ json: globalOpts.json });
	});

auth.addCommand(logoutCommand);

program
	.command("status")
	.description("Check auth status and Fibrous health")
	.action(async (_opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		await statusCommand({ ...globalOpts, json: globalOpts.json });
	});

program
	.command("tx-status")
	.description("Check transaction status and receipt")
	.argument("<hash>", "Transaction hash (0x...)")
	.action(async (hash, _opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		await txStatusCommand(hash, { ...globalOpts, json: globalOpts.json });
	});

program
	.command("wallets")
	.description("List wallets linked to a user email")
	.argument("<email>", "User email address")
	.option("-j, --json", "Output as JSON")
	.action(walletsCommand);

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
	.action(async (amount, recipient, token, _opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		await sendCommand(amount, recipient, token, { ...globalOpts, json: globalOpts.json });
	});

program
	.command("trade")
	.description("Swap tokens via Fibrous")
	.argument("<amount>", "Amount to swap")
	.argument("<from>", "Source token (symbol or address)")
	.argument("<to>", "Destination token (symbol or address)")
	.option("-s, --slippage <number>", "Slippage tolerance", "0.5")
	.option("--approve-max", "Approve maximum amount instead of exact amount", false)
	.action(async (amount, from, to, opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		await tradeCommand(amount, from, to, {
			...globalOpts,
			json: globalOpts.json,
			slippage: parseFloat(opts.slippage),
			approveMax: opts.approveMax,
		});
	});

program
	.command("aave")
	.description("Aave V3 operations (Base only)")
	.argument("<action>", "Action: status, supply, borrow, repay, withdraw")
	.argument("[amount]", "Amount")
	.argument("[token]", "Token symbol or address")
	.action(async (action, amount, token, _opts, cmd) => {
		const globalOpts = cmd.parent!.opts();
		await aaveCommand(action, amount, token, { ...globalOpts, json: globalOpts.json });
	});

program.parseAsync().catch((error: unknown) => {
	outputError(error, program.opts().json);
});
