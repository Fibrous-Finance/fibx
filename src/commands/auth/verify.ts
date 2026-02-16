import { apiVerify } from "../../services/api/client.js";
import { saveSession } from "../../services/auth/session.js";
import { outputResult, outputError, withSpinner, type OutputOptions } from "../../lib/format.js";

export async function authVerifyCommand(
	email: string,
	code: string,
	opts: OutputOptions
): Promise<void> {
	try {
		// 1. Verify OTP + provision wallet via backend
		const result = await withSpinner(
			"Verifying OTP...",
			async () => apiVerify(email, code),
			opts
		);

		// 2. Save session locally (store backend JWT instead of Privy token)
		await saveSession({
			userId: result.userId,
			walletId: result.walletId,
			walletAddress: result.walletAddress as `0x${string}`,
			userJwt: result.token,
			createdAt: new Date().toISOString(),
			type: "privy",
		});

		outputResult(
			{
				walletAddress: result.walletAddress,
				walletId: result.walletId,
				message: result.isExisting
					? "Existing wallet found and connected. You're ready to go!"
					: "New wallet created and session saved. You're ready to go!",
			},
			opts
		);
	} catch (error) {
		outputError(error, opts);
	}
}
