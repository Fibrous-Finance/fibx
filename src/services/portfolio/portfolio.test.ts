import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as Constants from "../chain/constants.js";

// Every network-facing module is replaced so nothing here reaches an RPC, and
// the session module is replaced outright so nothing reaches the developer's
// real config directory. The chain constants are deliberately NOT replaced:
// getChainConfig's refusal of a withdrawn chain is the real behaviour under
// test, so it is only wrapped, never stubbed.
const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	getChainConfig: vi.fn(),
}));

vi.mock("../auth/session.js", () => ({
	loadSession: mocks.loadSession,
	AUTH_HINT: "run fibx auth setup",
}));

vi.mock("../chain/constants.js", async (importOriginal) => {
	const actual = await importOriginal<typeof Constants>();
	mocks.getChainConfig.mockImplementation(actual.getChainConfig);
	return { ...actual, getChainConfig: mocks.getChainConfig };
});

vi.mock("../chain/client.js", () => ({
	getPublicClient: vi.fn(() => ({ getBalance: vi.fn(async () => 0n) })),
}));
vi.mock("../fibrous/tokens.js", () => ({ getTokens: vi.fn(async () => []) }));
vi.mock("../fibrous/balances.js", () => ({ getBalances: vi.fn(async () => []) }));
vi.mock("../defi/aave.js", () => ({
	// Any method the position fetch calls throws inside an async function,
	// which Promise.allSettled absorbs — exactly the failure mode a per-chain
	// fetch is allowed to have. What it is NOT allowed to do is throw before
	// allSettled ever starts.
	AaveService: class {},
}));

const { getPortfolio } = await import("./portfolio.js");
const { CHAIN_NAMES } = await import("../chain/constants.js");

beforeEach(() => {
	mocks.getChainConfig.mockClear();
	mocks.loadSession.mockReturnValue({
		walletAddress: "0x0000000000000000000000000000000000000001",
		type: "walletconnect",
	});
});

describe("getPortfolio across chains", () => {
	/**
	 * Regression. The chain list used to be derived from SUPPORTED_CHAINS, the
	 * structural table that deliberately keeps a withdrawn chain's row so old
	 * references still resolve. After Citrea was withdrawn, getChainConfig began
	 * refusing it — and that refusal fired synchronously while the
	 * Promise.allSettled array was still being built, so one withdrawn chain
	 * took the whole cross-chain portfolio down with it. Shipped in 0.9.0.
	 */
	it("never looks up a chain that is not offered", async () => {
		await expect(getPortfolio()).resolves.toBeDefined();

		const lookedUp = mocks.getChainConfig.mock.calls.map(([name]) => name);
		expect(lookedUp).not.toContain("citrea");
	});

	// The offered tuple is the one source of truth for "which chains do we
	// serve"; the portfolio must read that, not the structural table.
	it("looks up exactly the offered chains, in order", async () => {
		await getPortfolio();

		const lookedUp = mocks.getChainConfig.mock.calls
			.map(([name]) => name)
			// fetchAavePosition also resolves "base" for its own client; only the
			// cross-chain loop's lookups are under test here.
			.slice(0, CHAIN_NAMES.length);
		expect(lookedUp).toEqual([...CHAIN_NAMES]);
	});
});
