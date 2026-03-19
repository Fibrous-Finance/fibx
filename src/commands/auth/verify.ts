import { apiVerify } from "../../services/api/client.js";
import { saveSession } from "../../services/auth/session.js";
import { createSpinner, outputResult, formatError, type OutputOptions } from "../../lib/format.js";

export async function authVerifyCommand(
	email: string,
	code: string,
	opts: OutputOptions
): Promise<void> {
	const spinner = createSpinner("Verifying OTP...").start();

	try {
		const result = await apiVerify(email, code);

		spinner.text = "Saving session...";

		saveSession({
			userId: result.userId,
			walletId: result.walletId,
			walletAddress: result.walletAddress as `0x${string}`,
			userJwt: result.token,
			createdAt: new Date().toISOString(),
			type: "privy",
		});

		spinner.succeed(
			result.isExisting
				? "Existing wallet connected"
				: "New wallet created"
		);

		outputResult(
			{
				walletAddress: result.walletAddress,
				walletId: result.walletId,
				message: "You're ready to go!",
			},
			opts
		);
	} catch (error) {
		spinner.fail("Verification failed");
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
