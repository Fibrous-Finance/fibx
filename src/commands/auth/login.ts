import { apiLogin } from "../../services/api/client.js";
import { outputResult, outputError, withSpinner, type OutputOptions } from "../../lib/format.js";

export async function authLoginCommand(email: string, opts: OutputOptions): Promise<void> {
	try {
		await withSpinner("Sending OTP...", async () => apiLogin(email), opts);

		outputResult(
			{
				email,
				message: `OTP sent to ${email}. Run: fibx auth verify ${email} <code>`,
			},
			opts
		);
	} catch (error) {
		outputError(error, opts);
	}
}
