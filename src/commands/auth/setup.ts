import inquirer from "inquirer";
import chalk from "chalk";
import { formatError, type OutputOptions } from "../../lib/format.js";

export type Route = "connect" | "privy" | "import" | "explain";

/**
 * Pure so the routing is testable without driving a prompt.
 *
 * Anything unrecognised routes to the explanation rather than to a path: this
 * command hands someone their signing setup, and guessing at that is worse than
 * saying what the options are.
 */
export function routeChoice(choice: string): Route {
	if (choice === "1") return "connect";
	if (choice === "2") return "privy";
	if (choice === "3") return "import";
	return "explain";
}

const EXPLANATION = `
  You want to keep your own wallet AND have FibX act while you are away.
  That combination is not available today, and it is worth knowing why.

  It needs ERC-7715 — a standard that lets a wallet grant a scoped,
  expiring permission instead of approving each transaction. Wallets do
  not yet expose it over WalletConnect, and the one implementation that
  exists routes through a hosted co-signer, which puts a third party back
  in the path.

  The closest options:

    Connect your wallet (1) keeps your keys where they are. Every
    transaction is approved on your phone.

    Import a key (3) runs unattended on this machine, and you set the
    limits yourself with \`fibx policy\`.
`;

export async function authSetupCommand(opts: OutputOptions): Promise<void> {
	try {
		if (!process.stdout.isTTY) {
			console.error(
				formatError(
					new Error(
						"`fibx auth setup` asks questions, so it needs a terminal. Use `fibx auth connect`, `fibx auth login <email>` or `fibx auth import` directly."
					)
				)
			);
			process.exitCode = 1;
			return;
		}

		const { choice } = await inquirer.prompt<{ choice: string }>([
			{
				type: "list",
				name: "choice",
				message: "How should FibX sign?",
				choices: [
					{
						name: "Connect a wallet I already have — approved on your phone",
						value: "1",
					},
					{
						name: "Create a wallet FibX can use on its own — bounded by Privy",
						value: "2",
					},
					{
						name: "Import a private key — unattended, limits are yours to set",
						value: "3",
					},
					{ name: "I want my own wallet AND unattended operation", value: "?" },
				],
			},
		]);

		const route = routeChoice(choice);

		if (route === "explain") {
			console.log(chalk.gray(EXPLANATION));
			return;
		}

		if (route === "connect") {
			const { authConnectCommand } = await import("./connect.js");
			await authConnectCommand(opts);
			return;
		}

		if (route === "import") {
			const { authImportCommand } = await import("./import.js");
			const exitCodeBefore = process.exitCode;
			await authImportCommand(opts);

			// It catches its own errors and reports them by setting exitCode
			// rather than throwing, so that is the only signal there is. After
			// a failed or aborted import the hint below is advice about a
			// wallet that does not exist — and reads as confirmation that the
			// import worked.
			if (process.exitCode !== exitCodeBefore) return;

			console.log(
				chalk.gray(
					"\n  This path has no limits until you set some.\n" +
						"  Start with: fibx policy set base.maxValue 0.05\n"
				)
			);
			return;
		}

		const { email } = await inquirer.prompt<{ email: string }>([
			{ type: "input", name: "email", message: "Email for the one-time code:" },
		]);
		const { authLoginCommand } = await import("./login.js");
		await authLoginCommand(email, opts);
	} catch (error) {
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
