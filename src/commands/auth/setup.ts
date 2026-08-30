import inquirer from "inquirer";
import chalk from "chalk";
import { formatError, type OutputOptions } from "../../lib/format.js";
import { loadSession } from "../../services/auth/session.js";

export type Route = "connect" | "privy" | "import" | "explain" | "cancel";

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
	if (choice === "cancel") return "cancel";
	return "explain";
}

/**
 * The prompt's shape, exported so a test can pin it.
 *
 * `type` matters more than it looks: inquirer 13 renamed the legacy `list`
 * prompt to `select`, and an unregistered type does not fail — it renders a
 * prompt with no choices at all, accepts a keypress, and returns a value that
 * matches none of them. `auth setup` shipped that way, and no test caught it
 * because the only test covered `routeChoice`, which is pure and was never
 * wrong. Hence a test on this object.
 */
export const SIGNING_PROMPT = {
	type: "select",
	name: "choice",
	message: "How should FibX sign?",
	choices: [
		{
			name: "Connect a wallet I already have",
			value: "1",
			description: "Keys stay in your wallet. Every transaction goes to your phone.",
		},
		{
			name: "Create a wallet FibX can use on its own",
			value: "2",
			description: "Held by Privy, bounded by its policy. Works while you are away.",
		},
		{
			name: "Import a private key onto this machine",
			value: "3",
			description: "Fully unattended. Nothing bounds it until you set `fibx policy`.",
		},
		new inquirer.Separator(),
		{
			name: "None of these — I want my own wallet AND unattended operation",
			value: "?",
			description: "Explains why that combination is not available yet.",
		},
		{
			name: "Cancel",
			value: "cancel",
			description: "Leave the current signing setup alone.",
		},
	],
} as const;

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

/**
 * What is signing today, so the reader knows what a choice would replace.
 * Silent when there is no session — a first run has nothing to warn about.
 */
function describeCurrentSetup(): string | null {
	const session = loadSession();
	if (!session) return null;

	const kind =
		session.type === "walletconnect"
			? "your own wallet, over WalletConnect"
			: session.type === "private-key"
				? "a private key on this machine"
				: "a Privy wallet";

	return (
		`  Signing now: ${kind}\n` +
		`  ${session.walletAddress}\n` +
		`  Choosing a path below replaces this.\n`
	);
}

export async function authSetupCommand(opts: OutputOptions): Promise<void> {
	try {
		if (!process.stdout.isTTY || !process.stdin.isTTY) {
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

		console.log(
			chalk.gray(
				"\n  FibX needs a way to sign transactions. Three paths, different trade-offs.\n"
			)
		);
		const current = describeCurrentSetup();
		if (current) console.log(chalk.gray(current));

		// Loops so the explanation returns to the menu. Reading why a
		// combination is unavailable is not a reason to lose the choice.
		for (;;) {
			const { choice } = await inquirer.prompt<{ choice: string }>([SIGNING_PROMPT]);
			const route = routeChoice(choice);

			if (route === "explain") {
				console.log(chalk.gray(EXPLANATION));
				continue;
			}

			if (route === "cancel") {
				console.log(chalk.gray("  Nothing changed.\n"));
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
			return;
		}
	} catch (error) {
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
