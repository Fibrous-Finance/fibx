import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	endWalletConnectSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./session.js", () => ({ loadSession: mocks.loadSession }));
vi.mock("../walletconnect/connect.js", () => ({
	endWalletConnectSession: mocks.endWalletConnectSession,
}));

const { releaseWalletConnectSession } = await import("./release.js");

beforeEach(() => vi.clearAllMocks());

describe("releaseWalletConnectSession", () => {
	// The gap logout closed, which every other path that replaces a session had
	// too: the wallet keeps listing FibX as an active connection and the pairing
	// keys stay on disk.
	it("ends a live pairing and hands over its topic", async () => {
		mocks.loadSession.mockReturnValue({
			walletAddress: "0x1111111111111111111111111111111111111111",
			createdAt: "2026-08-29T00:00:00.000Z",
			type: "walletconnect",
			wcTopic: "topic-1",
		});

		await releaseWalletConnectSession();

		expect(mocks.endWalletConnectSession).toHaveBeenCalledWith("topic-1");
	});

	it("does nothing for a privy session", async () => {
		mocks.loadSession.mockReturnValue({
			walletAddress: "0x1111111111111111111111111111111111111111",
			createdAt: "2026-08-29T00:00:00.000Z",
			type: "privy",
			walletId: "wallet-1",
		});

		await releaseWalletConnectSession();

		expect(mocks.endWalletConnectSession).not.toHaveBeenCalled();
	});

	it("does nothing for a private-key session", async () => {
		mocks.loadSession.mockReturnValue({
			walletAddress: "0x1111111111111111111111111111111111111111",
			createdAt: "2026-08-29T00:00:00.000Z",
			type: "private-key",
		});

		await releaseWalletConnectSession();

		expect(mocks.endWalletConnectSession).not.toHaveBeenCalled();
	});

	it("does nothing when there is no session at all", async () => {
		mocks.loadSession.mockReturnValue(null);

		await releaseWalletConnectSession();

		expect(mocks.endWalletConnectSession).not.toHaveBeenCalled();
	});

	// A pairing with no topic cannot be disconnected, but its store still has to
	// go — endWalletConnectSession handles that, so it is still called.
	it("still runs teardown for a walletconnect session with no topic", async () => {
		mocks.loadSession.mockReturnValue({
			walletAddress: "0x1111111111111111111111111111111111111111",
			createdAt: "2026-08-29T00:00:00.000Z",
			type: "walletconnect",
		});

		await releaseWalletConnectSession();

		expect(mocks.endWalletConnectSession).toHaveBeenCalledWith(undefined);
	});
});
