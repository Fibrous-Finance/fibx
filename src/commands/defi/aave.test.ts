import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { aaveCommand } from "./aave.js";

const USER_ADDRESS = "0x1111111111111111111111111111111111111111" as Address;
const USDC_ADDRESS = "0x2222222222222222222222222222222222222222" as Address;
const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006" as Address;

const mocks = vi.hoisted(() => {
	const spinner = {
		text: "",
		start: vi.fn(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	};
	spinner.start.mockReturnValue(spinner);

	return {
		spinner,
		outputResult: vi.fn(),
		resolveToken: vi.fn(),
		aave: {
			getAccountAddress: vi.fn(),
			setWalletClient: vi.fn(),
			supply: vi.fn(),
			wrapETH: vi.fn(),
			unwrapWETH: vi.fn(),
			withdraw: vi.fn(),
			supplyWithAutoWrap: vi.fn(),
			borrow: vi.fn(),
			repay: vi.fn(),
			repayWithAutoWrap: vi.fn(),
			withdrawWithAutoUnwrap: vi.fn(),
		},
	};
});

vi.mock("../../services/defi/aave.js", () => ({
	AaveService: vi.fn(function MockAaveService() {
		return mocks.aave;
	}),
}));

vi.mock("../../services/chain/constants.js", () => ({
	getChainConfig: vi.fn(() => ({
		name: "base",
		nativeSymbol: "ETH",
		nativeTokenAddress: NATIVE_ADDRESS,
		wrappedNativeAddress: WETH_ADDRESS,
		viemChain: {
			blockExplorers: {
				default: { url: "https://basescan.org" },
			},
		},
	})),
}));

vi.mock("../../services/fibrous/tokens.js", () => ({
	resolveToken: mocks.resolveToken,
}));

vi.mock("../../services/auth/session.js", () => ({
	loadSession: vi.fn(() => ({ walletAddress: USER_ADDRESS })),
}));

vi.mock("../../services/chain/client.js", () => ({
	getWalletClient: vi.fn(() => ({
		account: { address: USER_ADDRESS },
	})),
}));

vi.mock("../../lib/format.js", () => ({
	createSpinner: vi.fn(() => mocks.spinner),
	outputResult: mocks.outputResult,
	formatResult: vi.fn(),
	formatError: vi.fn((error: unknown) => String(error)),
}));

describe("aaveCommand --simulate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.spinner.start.mockReturnValue(mocks.spinner);
		mocks.aave.getAccountAddress.mockReturnValue(USER_ADDRESS);
		mocks.resolveToken.mockResolvedValue({
			name: "USD Coin",
			symbol: "USDC",
			address: USDC_ADDRESS,
			decimals: 6,
		});
		process.exitCode = undefined;
	});

	it.each(["supply", "borrow", "repay", "withdraw"])(
		"previews %s without calling any write operation",
		async (action) => {
			await aaveCommand(action, "1", "USDC", {
				json: true,
				simulate: true,
			});

			expect(mocks.aave.supplyWithAutoWrap).not.toHaveBeenCalled();
			expect(mocks.aave.borrow).not.toHaveBeenCalled();
			expect(mocks.aave.repayWithAutoWrap).not.toHaveBeenCalled();
			expect(mocks.aave.withdrawWithAutoUnwrap).not.toHaveBeenCalled();
			expect(mocks.aave.supply).not.toHaveBeenCalled();
			expect(mocks.aave.wrapETH).not.toHaveBeenCalled();
			expect(mocks.aave.unwrapWETH).not.toHaveBeenCalled();
			expect(mocks.aave.withdraw).not.toHaveBeenCalled();
			expect(mocks.aave.repay).not.toHaveBeenCalled();
			expect(mocks.outputResult).toHaveBeenCalledWith(
				{
					mode: "PREVIEW (no TX sent)",
					action: action.charAt(0).toUpperCase() + action.slice(1),
					amount: "1",
					token: "USDC",
					chain: "base",
					note: "Request only; no on-chain validation, simulation, or transaction was performed",
				},
				{ json: true }
			);
			expect(process.exitCode).toBeUndefined();
		}
	);

	it("shows wrapped token semantics and normalizes max amounts in the preview", async () => {
		mocks.resolveToken.mockResolvedValue({
			name: "Ether",
			symbol: "ETH",
			address: NATIVE_ADDRESS,
			decimals: 18,
		});

		await aaveCommand("withdraw", "max", "ETH", {
			simulate: true,
		});

		expect(mocks.outputResult).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "Withdraw",
				amount: "MAX",
				token: "ETH (auto-unwrapped)",
			}),
			{ json: false }
		);
		expect(mocks.aave.withdrawWithAutoUnwrap).not.toHaveBeenCalled();
	});

	it("rejects max for actions that require a concrete amount", async () => {
		await aaveCommand("supply", "max", "USDC", {
			simulate: true,
		});

		expect(mocks.outputResult).not.toHaveBeenCalled();
		expect(mocks.resolveToken).not.toHaveBeenCalled();
		expect(mocks.aave.supplyWithAutoWrap).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	});
});
