import { describe, expect, it, vi, beforeEach } from "vitest";
import { ErrorCode } from "../../lib/errors.js";

const mocks = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@walletconnect/sign-client", () => ({ default: { init: mocks.init } }));

/**
 * A SignClient stubbed down to the two things shutdown touches. `heartbeat` is
 * the one that matters: Core.initialize() calls heartbeat.init() unconditionally
 * and @walletconnect/heartbeat@1.2.2 registers a plain setInterval with no
 * unref(), while @walletconnect/core never calls heartbeat.stop() itself. Close
 * the transport alone and the CLI prints its result and then hangs forever.
 */
function fakeSignClient() {
	const heartbeatStop = vi.fn();
	const transportClose = vi.fn().mockResolvedValue(undefined);
	return {
		heartbeatStop,
		transportClose,
		signClient: {
			core: {
				heartbeat: { stop: heartbeatStop },
				relayer: { transportClose },
			},
		},
	};
}

// The memo is module state, so every test gets a fresh module.
beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
});

describe("getSignClient", () => {
	it("initialises once and memoises the client", async () => {
		const { signClient } = fakeSignClient();
		mocks.init.mockResolvedValue(signClient);

		const { getSignClient } = await import("./client.js");
		const first = await getSignClient();
		const second = await getSignClient();

		expect(first).toBe(signClient);
		expect(second).toBe(signClient);
		expect(mocks.init).toHaveBeenCalledTimes(1);
	});

	// @walletconnect/logger writes pino records straight to the console. A
	// user cancelling a transaction produced a bare
	// `{ time: …, level: 50, msg: '' }` line above FibX's own output — noise
	// carrying nothing, since every failure here surfaces as a thrown FibxError.
	it("initialises the SDK with logging silenced", async () => {
		const { signClient } = fakeSignClient();
		mocks.init.mockResolvedValue(signClient);

		const { getSignClient } = await import("./client.js");
		await getSignClient();

		expect(mocks.init).toHaveBeenCalledWith(expect.objectContaining({ logger: "silent" }));
	});

	// A failed init must not be cached, or one unreachable relay poisons the
	// process for every later command.
	it("wraps an init failure as WALLET_ERROR and lets the next call retry", async () => {
		const { signClient } = fakeSignClient();
		mocks.init.mockRejectedValueOnce(new Error("relay unreachable"));
		mocks.init.mockResolvedValueOnce(signClient);

		const { getSignClient } = await import("./client.js");
		await expect(getSignClient()).rejects.toMatchObject({
			code: ErrorCode.WALLET_ERROR,
			message: expect.stringContaining("relay unreachable"),
		});
		await expect(getSignClient()).resolves.toBe(signClient);
		expect(mocks.init).toHaveBeenCalledTimes(2);
	});
});

describe("closeSignClient", () => {
	/**
	 * The regression signal for the hang. Without heartbeat.stop() the process
	 * stays alive on an interval nothing else clears, so `fibx auth connect`
	 * prints "Wallet connected" and never returns the shell prompt — and so does
	 * every WalletConnect signing command after printing its hash.
	 */
	it("stops the heartbeat as well as closing the transport", async () => {
		const { signClient, heartbeatStop, transportClose } = fakeSignClient();
		mocks.init.mockResolvedValue(signClient);

		const { getSignClient, closeSignClient } = await import("./client.js");
		await getSignClient();
		await closeSignClient();

		expect(heartbeatStop).toHaveBeenCalledTimes(1);
		expect(transportClose).toHaveBeenCalledTimes(1);
	});

	// index.ts calls it unconditionally after every command, and almost no
	// command opens a relay connection.
	it("is a no-op when no client was ever opened", async () => {
		const { closeSignClient } = await import("./client.js");

		await expect(closeSignClient()).resolves.toBeUndefined();
		expect(mocks.init).not.toHaveBeenCalled();
	});

	it("is idempotent — a second call closes nothing twice", async () => {
		const { signClient, heartbeatStop, transportClose } = fakeSignClient();
		mocks.init.mockResolvedValue(signClient);

		const { getSignClient, closeSignClient } = await import("./client.js");
		await getSignClient();
		await closeSignClient();
		await closeSignClient();

		expect(heartbeatStop).toHaveBeenCalledTimes(1);
		expect(transportClose).toHaveBeenCalledTimes(1);
	});

	// The MCP server is long-lived and may pair again after a teardown.
	it("clears the memo so a later getSignClient re-initialises", async () => {
		const first = fakeSignClient();
		const second = fakeSignClient();
		mocks.init.mockResolvedValueOnce(first.signClient);
		mocks.init.mockResolvedValueOnce(second.signClient);

		const { getSignClient, closeSignClient } = await import("./client.js");
		expect(await getSignClient()).toBe(first.signClient);
		await closeSignClient();
		expect(await getSignClient()).toBe(second.signClient);
		expect(mocks.init).toHaveBeenCalledTimes(2);
	});

	// Closing is best-effort: the process is exiting either way, and a failure
	// here must not turn a successful command into a failed one.
	it("swallows a transport that refuses to close", async () => {
		const { signClient, heartbeatStop, transportClose } = fakeSignClient();
		transportClose.mockRejectedValue(new Error("socket already gone"));
		mocks.init.mockResolvedValue(signClient);

		const { getSignClient, closeSignClient } = await import("./client.js");
		await getSignClient();

		await expect(closeSignClient()).resolves.toBeUndefined();
		expect(heartbeatStop).toHaveBeenCalledTimes(1);
	});

	// An init that never resolved still leaves a memo behind; closing must not
	// reject on it either.
	it("swallows a client whose init failed", async () => {
		mocks.init.mockRejectedValue(new Error("relay unreachable"));

		const { getSignClient, closeSignClient } = await import("./client.js");
		await expect(getSignClient()).rejects.toThrow();

		await expect(closeSignClient()).resolves.toBeUndefined();
	});
});
