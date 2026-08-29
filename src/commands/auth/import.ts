import {
	createSpinner,
	outputResult,
	formatError,
	warn,
	type OutputOptions,
} from "../../lib/format.js";
import { saveSession } from "../../services/auth/session.js";
import { releaseWalletConnectSession } from "../../services/auth/release.js";
import { privateKeyToAccount } from "viem/accounts";
import { type Hex } from "viem";
import inquirer from "inquirer";

export async function authImportCommand(opts: OutputOptions): Promise<void> {
	try {
		const { privateKey } = await inquirer.prompt([
			{
				type: "password",
				name: "privateKey",
				message: "Enter your private key (0x...):",
				validate: (input: string) => {
					if (!/^0x[a-fA-F0-9]{64}$/.test(input)) {
						return "Invalid private key format. Must start with 0x and be 66 chars long.";
					}
					return true;
				},
			},
		]);

		const spinner = createSpinner("Importing key...").start();

		const account = privateKeyToAccount(privateKey as Hex);
		const address = account.address;

		// Switching to a local key leaves any WalletConnect pairing live in the
		// user's wallet and its keys on disk unless it is ended first.
		await releaseWalletConnectSession();

		saveSession({
			userId: "local-user",
			walletAddress: address,
			createdAt: new Date().toISOString(),
			type: "private-key",
			privateKey: privateKey,
		});

		spinner.succeed("Private key imported");

		outputResult(
			{
				address: address,
				type: "private-key",
				message: "You're ready to go!",
			},
			opts
		);

		console.log(warn("Your private key is stored locally in session.json."));
		console.log(warn("Make sure your machine is secure."));
	} catch (error) {
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
