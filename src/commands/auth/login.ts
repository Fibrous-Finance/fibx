import { apiLogin } from "../../services/api/client.js";
import { outputResult, type OutputOptions } from "../../lib/format.js";
import { runCommand } from "../../lib/cli-helpers.js";

export async function authLoginCommand(email: string, opts: OutputOptions): Promise<void> {
	await runCommand(
		"Sending OTP...",
		"OTP sent",
		"Failed to send OTP",
		async () => {
			await apiLogin(email);
			return { email };
		},
		(data) =>
			outputResult(
				{
					email: data.email,
					message: `OTP sent to ${email}. Run: fibx auth verify ${email} <code>`,
				},
				opts
			),
		opts
	);
}
