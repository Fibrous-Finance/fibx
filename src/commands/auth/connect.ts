import { createPairing } from "../../services/walletconnect/connect.js";
import { renderQrTerminal } from "../../services/walletconnect/qr.js";
import { saveSession } from "../../services/auth/session.js";
import { createSpinner, outputResult, formatError, type OutputOptions } from "../../lib/format.js";

export async function authConnectCommand(opts: OutputOptions): Promise<void> {
	// Held outside the try so the catch can stop whichever of these is still
	// animating — ora only clears its interval on stop()/succeed()/fail(), and
	// the user declining in their wallet is the most ordinary way to land here.
	let pairingSpinner: ReturnType<typeof createSpinner> | undefined;
	let approvalSpinner: ReturnType<typeof createSpinner> | undefined;

	try {
		pairingSpinner = createSpinner("Opening a WalletConnect pairing...").start();
		const { uri, approval } = await createPairing();
		pairingSpinner.stop();
		pairingSpinner = undefined;

		if (opts.json) {
			// A machine caller wants the URI, not a picture of it. This is NDJSON:
			// one compact JSON document per line, so a caller can JSON.parse()
			// each line as it arrives rather than the whole run as one document.
			console.log(JSON.stringify({ uri }));
		} else {
			console.log(await renderQrTerminal(uri));
			console.log("Scan with your wallet, or paste this URI into it:\n");
			console.log(uri + "\n");
		}

		approvalSpinner = createSpinner("Waiting for approval in your wallet...").start();
		const session = await approval();
		// createSpinner returns NonTtySpinner whenever stdout is not a TTY —
		// which is exactly when a script pipes us and passes --json — and its
		// succeed() writes to stdout. That line would land between the two JSON
		// documents and break the per-line JSON.parse contract the README
		// documents. stop() still clears ora's interval on the TTY path, so the
		// process is not left with a live handle.
		if (opts.json) approvalSpinner.stop();
		else approvalSpinner.succeed("Wallet connected");
		approvalSpinner = undefined;

		saveSession({
			walletAddress: session.address,
			createdAt: new Date().toISOString(),
			type: "walletconnect",
			wcTopic: session.topic,
		});

		const result = {
			address: session.address,
			type: "walletconnect",
			message: "You're ready to go. Transactions will appear in your wallet for approval.",
		};

		if (opts.json) {
			// Compact, matching the uri line above — one JSON document per line.
			console.log(JSON.stringify(result));
		} else {
			outputResult(result, opts);
		}
	} catch (error) {
		pairingSpinner?.fail("Could not open a pairing");
		approvalSpinner?.fail("Wallet did not connect");
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
