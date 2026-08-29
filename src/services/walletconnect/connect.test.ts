import { describe, expect, it, vi, beforeEach } from "vitest";
import { FibxError, ErrorCode } from "../../lib/errors.js";

const mocks = vi.hoisted(() => ({
	getSignClient: vi.fn(),
	destroy: vi.fn(),
	walletConnectStore: vi.fn(),
}));
vi.mock("./client.js", () => ({
	getSignClient: mocks.getSignClient,
	walletConnectStore: mocks.walletConnectStore,
}));

const { createPairing, getActiveSession, endWalletConnectSession } = await import("./connect.js");

const APPROVED = {
	topic: "topic-1",
	namespaces: {
		eip155: { accounts: ["eip155:8453:0xAbC0000000000000000000000000000000000001"] },
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.walletConnectStore.mockReturnValue({ destroy: mocks.destroy });
});

describe("createPairing", () => {
	it("returns the uri and resolves to the approved address", async () => {
		mocks.getSignClient.mockResolvedValue({
			connect: vi.fn().mockResolvedValue({
				uri: "wc:abc@2?relay-protocol=irn&symKey=deadbeef",
				approval: vi.fn().mockResolvedValue(APPROVED),
			}),
		});

		const pairing = await createPairing();
		expect(pairing.uri).toMatch(/^wc:/);

		const session = await pairing.approval();
		expect(session.topic).toBe("topic-1");
		expect(session.address).toBe("0xAbC0000000000000000000000000000000000001");
	});

	it("fails clearly when the relay returns no uri", async () => {
		mocks.getSignClient.mockResolvedValue({
			connect: vi.fn().mockResolvedValue({ uri: undefined, approval: vi.fn() }),
		});

		await expect(createPairing()).rejects.toMatchObject({
			code: ErrorCode.WALLET_ERROR,
		});
	});

	// The relay can also fail before a uri exists at all — e.g. unreachable.
	it("wraps a proposal failure as WALLET_ERROR", async () => {
		mocks.getSignClient.mockResolvedValue({
			connect: vi.fn().mockRejectedValue(new Error("Relay unreachable")),
		});

		await expect(createPairing()).rejects.toMatchObject({
			code: ErrorCode.WALLET_ERROR,
		});
	});

	// A user closing the wallet is a normal outcome, not a crash.
	it("surfaces a rejected pairing as WALLET_ERROR", async () => {
		mocks.getSignClient.mockResolvedValue({
			connect: vi.fn().mockResolvedValue({
				uri: "wc:abc@2",
				approval: vi.fn().mockRejectedValue(new Error("User rejected.")),
			}),
		});

		const pairing = await createPairing();
		await expect(pairing.approval()).rejects.toBeInstanceOf(FibxError);
	});

	it("fails when the wallet approves no account", async () => {
		mocks.getSignClient.mockResolvedValue({
			connect: vi.fn().mockResolvedValue({
				uri: "wc:abc@2",
				approval: vi.fn().mockResolvedValue({
					topic: "topic-2",
					namespaces: { eip155: { accounts: [] } },
				}),
			}),
		});

		const pairing = await createPairing();
		await expect(pairing.approval()).rejects.toMatchObject({
			code: ErrorCode.WALLET_ERROR,
		});
	});
});

describe("getActiveSession", () => {
	it("returns the stored session", async () => {
		mocks.getSignClient.mockResolvedValue({
			session: { get: vi.fn().mockReturnValue(APPROVED) },
		});

		await expect(getActiveSession("topic-1")).resolves.toEqual(APPROVED);
	});

	it("reports an expired session with a reconnect instruction", async () => {
		mocks.getSignClient.mockResolvedValue({
			session: {
				get: vi.fn(() => {
					throw new Error("No matching key");
				}),
			},
		});

		await expect(getActiveSession("gone")).rejects.toMatchObject({
			code: ErrorCode.SESSION_EXPIRED,
		});
		await expect(getActiveSession("gone")).rejects.toThrow(/fibx auth connect/);
	});
});

describe("endWalletConnectSession", () => {
	// Without this the wallet keeps listing FibX as an active connection long
	// after "Logged out. Session cleared.", and the keys authorising it stay in
	// the config directory.
	it("disconnects the wallet's side and removes the pairing material", async () => {
		const disconnect = vi.fn().mockResolvedValue(undefined);
		mocks.getSignClient.mockResolvedValue({ disconnect });

		await endWalletConnectSession("topic-1");

		expect(disconnect).toHaveBeenCalledWith({
			topic: "topic-1",
			reason: { code: 6000, message: "User disconnected." },
		});
		expect(mocks.destroy).toHaveBeenCalledTimes(1);
	});

	// The user asked to leave. An unreachable relay, or a session the wallet has
	// already dropped, must not keep them logged in — and the local key material
	// goes regardless, which is the half that matters if only one can be done.
	it("still removes the pairing material when the relay refuses", async () => {
		mocks.getSignClient.mockRejectedValue(new Error("Relay unreachable"));

		await expect(endWalletConnectSession("topic-1")).resolves.toBeUndefined();
		expect(mocks.destroy).toHaveBeenCalledTimes(1);
	});

	// A walletconnect session with no topic cannot be disconnected, but its
	// store still has to go.
	it("removes the pairing material without a topic to disconnect", async () => {
		await endWalletConnectSession(undefined);

		expect(mocks.getSignClient).not.toHaveBeenCalled();
		expect(mocks.destroy).toHaveBeenCalledTimes(1);
	});

	// A rejection is already handled above, but a stall is not a rejection.
	// disconnect() reaches Relayer.connect(), which retries five times with 15s
	// timeouts plus backoff, so a reachable-but-blackholed relay would sit on the
	// user's terminal for minutes after they asked to leave.
	it("gives up on a disconnect that never settles", async () => {
		vi.useFakeTimers();
		try {
			const disconnect = vi.fn(() => new Promise<void>(() => {}));
			mocks.getSignClient.mockResolvedValue({ disconnect });

			const done = endWalletConnectSession("topic-1");
			await vi.runAllTimersAsync();

			await expect(done).resolves.toBeUndefined();
			expect(mocks.destroy).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not fail a logout when the store cannot be removed", async () => {
		const disconnect = vi.fn().mockResolvedValue(undefined);
		mocks.getSignClient.mockResolvedValue({ disconnect });
		mocks.destroy.mockImplementation(() => {
			throw new Error("EACCES");
		});

		await expect(endWalletConnectSession("topic-1")).resolves.toBeUndefined();
	});
});
