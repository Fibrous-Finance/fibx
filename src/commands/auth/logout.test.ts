import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Session } from "../../services/auth/session.js";

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	clearSession: vi.fn(),
	endWalletConnectSession: vi.fn(),
}));

// Mocked so the test cannot delete the developer's own session.json.
vi.mock("../../services/auth/session.js", () => ({
	loadSession: mocks.loadSession,
	clearSession: mocks.clearSession,
}));
vi.mock("../../services/walletconnect/connect.js", () => ({
	endWalletConnectSession: mocks.endWalletConnectSession,
}));

const { logoutCommand } = await import("./logout.js");

const WC_SESSION: Session = {
	walletAddress: "0x1111111111111111111111111111111111111111",
	createdAt: "2026-08-29T00:00:00.000Z",
	type: "walletconnect",
	wcTopic: "topic-1",
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.endWalletConnectSession.mockResolvedValue(undefined);
});

async function logout() {
	await logoutCommand.parseAsync([], { from: "user" });
}

describe("auth logout", () => {
	/**
	 * Clearing session.json alone left the wallet listing FibX as an active
	 * connection and the symmetric keys authorising it in the config directory,
	 * both indefinitely, under the message "Logged out. Session cleared."
	 */
	it("tears down the WalletConnect pairing before clearing the session", async () => {
		mocks.loadSession.mockReturnValue(WC_SESSION);

		await logout();

		expect(mocks.endWalletConnectSession).toHaveBeenCalledWith("topic-1");
		expect(mocks.clearSession).toHaveBeenCalledTimes(1);
	});

	it("leaves the other two auth paths untouched", async () => {
		for (const type of ["privy", "private-key"] as const) {
			vi.clearAllMocks();
			mocks.loadSession.mockReturnValue({ ...WC_SESSION, type, wcTopic: undefined });

			await logout();

			expect(mocks.endWalletConnectSession).not.toHaveBeenCalled();
			expect(mocks.clearSession).toHaveBeenCalledTimes(1);
		}
	});

	it("still clears when there is no session at all", async () => {
		mocks.loadSession.mockReturnValue(null);

		await logout();

		expect(mocks.endWalletConnectSession).not.toHaveBeenCalled();
		expect(mocks.clearSession).toHaveBeenCalledTimes(1);
	});

	// The user asked to leave; a teardown that cannot reach the relay must not
	// strand them in a half-logged-out state.
	it("clears the session even when the teardown fails", async () => {
		mocks.loadSession.mockReturnValue(WC_SESSION);
		mocks.endWalletConnectSession.mockRejectedValue(new Error("relay unreachable"));

		await logout();

		expect(mocks.clearSession).toHaveBeenCalledTimes(1);
	});
});
