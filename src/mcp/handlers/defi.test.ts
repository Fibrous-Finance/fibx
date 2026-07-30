import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireSession: vi.fn(),
	getWalletClient: vi.fn(),
	resolveToken: vi.fn(),
	aave: {
		setWalletClient: vi.fn(),
		supplyWithAutoWrap: vi.fn(),
		borrow: vi.fn(),
		repayWithAutoWrap: vi.fn(),
		withdrawWithAutoUnwrap: vi.fn(),
	},
}));

vi.mock("../../services/auth/session.js", () => ({
	loadSession: vi.fn(),
	requireSession: mocks.requireSession,
}));

vi.mock("../../services/chain/constants.js", () => ({
	getChainConfig: vi.fn(() => ({
		name: "base",
		nativeSymbol: "ETH",
		nativeTokenAddress: "0x0000000000000000000000000000000000000000",
		wrappedNativeAddress: "0x4200000000000000000000000000000000000006",
		viemChain: {},
	})),
}));

vi.mock("../../services/chain/client.js", () => ({
	getWalletClient: mocks.getWalletClient,
}));

vi.mock("../../services/fibrous/tokens.js", () => ({
	resolveToken: mocks.resolveToken,
}));

vi.mock("../../services/defi/aave.js", () => ({
	AaveService: vi.fn(function MockAaveService() {
		return mocks.aave;
	}),
}));

import { handleAaveAction } from "./defi.js";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requireSession.mockReturnValue({
		walletAddress: "0x1111111111111111111111111111111111111111",
	});
	mocks.getWalletClient.mockReturnValue({
		account: { address: "0x1111111111111111111111111111111111111111" },
	});
	mocks.resolveToken.mockResolvedValue({
		name: "USD Coin",
		symbol: "USDC",
		address: "0x2222222222222222222222222222222222222222",
		decimals: 6,
	});
});

describe("handleAaveAction simulate", () => {
	it.each(["supply", "borrow", "repay", "withdraw"] as const)(
		"previews %s without invoking an Aave write",
		async (action) => {
			const result = await handleAaveAction({
				action,
				amount: "1",
				token: "USDC",
				simulate: true,
			});
			const payload = JSON.parse(result.content[0].text);

			expect(payload).toMatchObject({
				success: true,
				mode: "PREVIEW (no TX sent)",
				action,
				amount: "1",
				token: "USDC",
				chain: "base",
				note: "Request only; no on-chain validation, gas estimate, or transaction was performed",
			});
			expect(mocks.aave.supplyWithAutoWrap).not.toHaveBeenCalled();
			expect(mocks.aave.borrow).not.toHaveBeenCalled();
			expect(mocks.aave.repayWithAutoWrap).not.toHaveBeenCalled();
			expect(mocks.aave.withdrawWithAutoUnwrap).not.toHaveBeenCalled();
		}
	);

	it("rejects max for supply before resolving a token or invoking Aave", async () => {
		await expect(
			handleAaveAction({
				action: "supply",
				amount: "max",
				token: "USDC",
				simulate: true,
			})
		).rejects.toThrow("'max' is only supported for repay and withdraw.");

		expect(mocks.resolveToken).not.toHaveBeenCalled();
		expect(mocks.aave.supplyWithAutoWrap).not.toHaveBeenCalled();
	});

	it("describes native-token conversion without implying borrowed WETH is unwrapped", async () => {
		mocks.resolveToken.mockResolvedValue({
			name: "Ether",
			symbol: "ETH",
			address: "0x0000000000000000000000000000000000000000",
			decimals: 18,
		});

		const withdrawResult = await handleAaveAction({
			action: "withdraw",
			amount: "max",
			token: "ETH",
			simulate: true,
		});
		const borrowResult = await handleAaveAction({
			action: "borrow",
			amount: "1",
			token: "ETH",
			simulate: true,
		});

		expect(JSON.parse(withdrawResult.content[0].text)).toMatchObject({
			amount: "MAX",
			token: "ETH (auto-unwrapped)",
		});
		expect(JSON.parse(borrowResult.content[0].text)).toMatchObject({
			amount: "1",
			token: "WETH",
		});
		expect(mocks.aave.borrow).not.toHaveBeenCalled();
		expect(mocks.aave.withdrawWithAutoUnwrap).not.toHaveBeenCalled();
	});
});
