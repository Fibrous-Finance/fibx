import { beforeEach, describe, expect, it, vi } from "vitest";

// Every handler open_fibx composes is mocked at the module boundary, so this
// test reaches neither the network nor the real config directory
// (~/Library/Preferences/fibx-nodejs — a live session and an encrypted key).
const mocks = vi.hoisted(() => ({
	handleGetAuthStatus: vi.fn(),
	handleGetBalance: vi.fn(),
	handleGetPolicy: vi.fn(),
	handleGetQuote: vi.fn(),
	getTokens: vi.fn(),
	getChainConfig: vi.fn(),
}));

vi.mock("./auth.js", () => ({ handleGetAuthStatus: mocks.handleGetAuthStatus }));
vi.mock("./wallet.js", () => ({ handleGetBalance: mocks.handleGetBalance }));
vi.mock("./policy.js", () => ({ handleGetPolicy: mocks.handleGetPolicy }));
vi.mock("./quote.js", () => ({ handleGetQuote: mocks.handleGetQuote }));
vi.mock("../../services/fibrous/tokens.js", () => ({ getTokens: mocks.getTokens }));
vi.mock("../../services/chain/constants.js", () => ({
	getChainConfig: mocks.getChainConfig,
}));

const { handleOpenFibx, handleListTokens } = await import("./app.js");
const { jsonResult, unwrapJson } = await import("./utils.js");

const AUTHED = {
	authenticated: true,
	walletAddress: "0x0363000000000000000000000000000000003d44",
	sessionType: "walletconnect",
	chain: "base",
	requiresApprovalPerTransaction: true,
	fibrousStatus: "alive",
};
const ANON = { ...AUTHED, authenticated: false, walletAddress: null, sessionType: null };
const POLICY_ABSENT = { state: "absent", path: "/p", message: "No signing policy is set" };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getChainConfig.mockReturnValue({ name: "base", fibrousNetwork: "base" });
	mocks.handleGetPolicy.mockResolvedValue(jsonResult(POLICY_ABSENT));
});

describe("open_fibx", () => {
	it("opens bare: auth and policy, no balances, no terms, no quote", async () => {
		mocks.handleGetAuthStatus.mockResolvedValue(jsonResult(ANON));

		const snap = unwrapJson<Record<string, unknown>>(await handleOpenFibx({ chain: "base" }));

		expect(snap.chain).toBe("base");
		expect(snap.auth).toEqual(ANON);
		expect(snap.policy).toEqual(POLICY_ABSENT);
		expect(snap.balances).toBeNull();
		expect(snap.terms).toBeNull();
		expect(snap.quote).toBeNull();
		expect(snap.quoteError).toBeNull();
		expect(mocks.handleGetBalance).not.toHaveBeenCalled();
		expect(mocks.handleGetQuote).not.toHaveBeenCalled();
	});

	it("fetches balances only when authenticated", async () => {
		mocks.handleGetAuthStatus.mockResolvedValue(jsonResult(AUTHED));
		mocks.handleGetBalance.mockResolvedValue(
			jsonResult({ wallet: AUTHED.walletAddress, chain: "base", balances: { ETH: "0.0002" } })
		);

		const snap = unwrapJson<{ balances: unknown }>(await handleOpenFibx({ chain: "base" }));

		expect(snap.balances).toEqual({ ETH: "0.0002" });
		expect(mocks.handleGetBalance).toHaveBeenCalledWith({ chain: "base" });
	});

	// The app must open even when a part of it cannot be filled. A balance
	// fetch that fails is a blank balance, not a closed door.
	it("opens with null balances when the balance call fails", async () => {
		mocks.handleGetAuthStatus.mockResolvedValue(jsonResult(AUTHED));
		mocks.handleGetBalance.mockRejectedValue(new Error("rpc down"));

		const snap = unwrapJson<{ balances: unknown; auth: unknown }>(
			await handleOpenFibx({ chain: "base" })
		);

		expect(snap.balances).toBeNull();
		expect(snap.auth).toEqual(AUTHED);
	});

	it("pre-fills: terms are echoed and the quote is fetched with them", async () => {
		mocks.handleGetAuthStatus.mockResolvedValue(jsonResult(ANON));
		mocks.handleGetQuote.mockResolvedValue(
			jsonResult({ input: "0.001 ETH", output: "~2.45 USDC", rate: "r", chain: "base" })
		);

		const snap = unwrapJson<{ terms: unknown; quote: unknown }>(
			await handleOpenFibx({ chain: "base", from: "ETH", to: "USDC", amount: "0.001" })
		);

		expect(snap.terms).toEqual({ from: "ETH", to: "USDC", amount: "0.001", slippage: 0.5 });
		expect(mocks.handleGetQuote).toHaveBeenCalledWith({
			amount: "0.001",
			from_token: "ETH",
			to_token: "USDC",
			chain: "base",
			slippage: 0.5,
		});
		expect(snap.quote).toEqual({
			input: "0.001 ETH",
			output: "~2.45 USDC",
			rate: "r",
			chain: "base",
		});
	});

	// A quote that fails is the single most common way this tool will be
	// called with bad input ("swap 1 XYZ") — the app opens with the terms and
	// the reason, so the user can fix the token in the picker.
	it("opens with quoteError when the quote fails, keeping the terms", async () => {
		mocks.handleGetAuthStatus.mockResolvedValue(jsonResult(ANON));
		mocks.handleGetQuote.mockRejectedValue(new Error("Token not found: XYZ"));

		const snap = unwrapJson<{ terms: unknown; quote: unknown; quoteError: unknown }>(
			await handleOpenFibx({ chain: "base", from: "XYZ", to: "USDC", amount: "1" })
		);

		expect(snap.terms).toEqual({ from: "XYZ", to: "USDC", amount: "1", slippage: 0.5 });
		expect(snap.quote).toBeNull();
		expect(snap.quoteError).toBe("Token not found: XYZ");
	});

	it("treats partial terms as no terms", async () => {
		mocks.handleGetAuthStatus.mockResolvedValue(jsonResult(ANON));

		const snap = unwrapJson<{ terms: unknown }>(
			await handleOpenFibx({ chain: "base", from: "ETH" })
		);

		expect(snap.terms).toBeNull();
		expect(mocks.handleGetQuote).not.toHaveBeenCalled();
	});
});

describe("list_tokens", () => {
	it("returns the chain's tokens as a list sorted by symbol", async () => {
		mocks.getTokens.mockResolvedValue({
			"0xb": { symbol: "USDC", name: "USD Coin", address: "0xb", decimals: 6, price: "1" },
			"0xa": { symbol: "ETH", name: "Ether", address: "0xa", decimals: 18 },
		});

		const out = unwrapJson<{ chain: string; tokens: { symbol: string }[] }>(
			await handleListTokens({ chain: "base" })
		);

		expect(out.chain).toBe("base");
		expect(out.tokens.map((t) => t.symbol)).toEqual(["ETH", "USDC"]);
	});
});
