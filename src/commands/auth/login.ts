import { apiLogin } from "../../services/api/client.js";
import { createSpinner, outputResult, formatError, type OutputOptions } from "../../lib/format.js";

export async function authLoginCommand(email: string, opts: OutputOptions): Promise<void> {
	const spinner = createSpinner("Sending OTP...").start();

	try {
		await apiLogin(email);

		spinner.succeed("OTP sent");

		outputResult(
			{
				email,
				message: `OTP sent to ${email}. Run: fibx auth verify ${email} <code>`,
			},
			opts
		);
	} catch (error) {
		spinner.fail("Failed to send OTP");
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
