import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
	createPairing: vi.fn(),
	renderQrTerminal: vi.fn(),
	saveSession: vi.fn(),
	releaseWalletConnectSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/walletconnect/connect.js", () => ({ createPairing: mocks.createPairing }));
vi.mock("../../services/walletconnect/qr.js", () => ({ renderQrTerminal: mocks.renderQrTerminal }));
// Never let this reach the real session file: saveSession writes to the
// developer's own config directory.
vi.mock("../../services/auth/session.js", () => ({ saveSession: mocks.saveSession }));
vi.mock("../../services/auth/release.js", () => ({
	releaseWalletConnectSession: mocks.releaseWalletConnectSession,
}));

const { authConnectCommand } = await import("./connect.js");

const URI = "wc:abc@2?relay-protocol=irn&symKey=deadbeef";
const ADDRESS = "0x1111111111111111111111111111111111111111";

const originalIsTty = process.stdout.isTTY;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.renderQrTerminal.mockResolvedValue("[qr]");
	mocks.createPairing.mockResolvedValue({
		uri: URI,
		approval: async () => ({ topic: "topic-1", address: ADDRESS }),
	});
});

afterEach(() => {
	process.stdout.isTTY = originalIsTty;
	vi.restoreAllMocks();
});

/** Everything the command wrote to stdout, one entry per console.log call. */
function captureStdout() {
	const lines: string[] = [];
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		lines.push(args.map(String).join(" "));
	});
	return lines;
}

describe("auth connect --json", () => {
	/**
	 * createSpinner() returns the non-TTY shim whenever stdout is not a TTY,
	 * which is exactly the case a script hits when it pipes us — and a piped
	 * caller is who passes --json. That shim's succeed() writes to stdout, so a
	 * "Wallet connected" line landed between the two JSON documents and broke
	 * the per-line JSON.parse contract the README documents. On a TTY ora writes
	 * to stderr, which is why this never showed up by hand.
	 */
	it("emits nothing on stdout that is not JSON when piped", async () => {
		process.stdout.isTTY = false;
		const lines = captureStdout();

		await authConnectCommand({ json: true });

		expect(lines.length).toBeGreaterThan(0);
		const parsed = lines.map((line) => JSON.parse(line) as unknown);
		expect(parsed).toEqual([
			{ uri: URI },
			{ address: ADDRESS, type: "walletconnect", message: expect.any(String) },
		]);
		expect(process.exitCode).not.toBe(1);
	});

	// The human path must keep its confirmation — the fix guards the spinner,
	// it does not delete it.
	it("still confirms the connection on the human path", async () => {
		process.stdout.isTTY = false;
		const lines = captureStdout();

		await authConnectCommand({ json: false });

		expect(lines.join("\n")).toContain("Wallet connected");
		expect(lines.join("\n")).toContain(URI);
	});
});

describe("auth connect over an existing pairing", () => {
	// Teardown destroys the whole pairing store, so it has to run before this
	// command's own pairing exists — afterwards it would take the new keys with
	// it. Pairing again without it leaves the previous session live in the
	// user's wallet.
	it("releases the previous session before opening a new pairing", async () => {
		await authConnectCommand({ json: true });

		expect(mocks.releaseWalletConnectSession).toHaveBeenCalledTimes(1);
		expect(mocks.releaseWalletConnectSession.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.createPairing.mock.invocationCallOrder[0]
		);
	});
});
