import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireSession: vi.fn(),
	getChainConfig: vi.fn(),
	getPublicClient: vi.fn(),
	getWalletClient: vi.fn(),
	resolveToken: vi.fn(),
	getRouteAndCallData: vi.fn(),
	encodeSwapCalldata: vi.fn(),
	getAllowance: vi.fn(),
	encodeApprove: vi.fn(),
	waitForAllowance: vi.fn(),
	sendTransaction: vi.fn(),
	waitForTransactionReceipt: vi.fn(),
	estimateGas: vi.fn(),
}));

vi.mock("../../services/auth/session.js", () => ({
	requireSession: mocks.requireSession,
}));

vi.mock("../../services/chain/constants.js", () => ({
	getChainConfig: mocks.getChainConfig,
}));

vi.mock("../../services/chain/client.js", () => ({
	getPublicClient: mocks.getPublicClient,
	getWalletClient: mocks.getWalletClient,
}));

vi.mock("../../services/fibrous/tokens.js", () => ({
	resolveToken: mocks.resolveToken,
}));

vi.mock("../../services/fibrous/route.js", () => ({
	getRouteAndCallData: mocks.getRouteAndCallData,
	encodeSwapCalldata: mocks.encodeSwapCalldata,
}));

vi.mock("../../services/chain/erc20.js", () => ({
	getAllowance: mocks.getAllowance,
	encodeApprove: mocks.encodeApprove,
	encodeDeposit: vi.fn(),
	encodeWithdraw: vi.fn(),
	waitForAllowance: mocks.waitForAllowance,
}));

import { handleSwapTokens } from "./trade.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const TOKEN_IN = "0x2222222222222222222222222222222222222222";
const TOKEN_OUT = "0x3333333333333333333333333333333333333333";
const ROUTER = "0x4444444444444444444444444444444444444444";
const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";
const WRAPPED_NATIVE = "0x4200000000000000000000000000000000000006";

beforeEach(() => {
	vi.clearAllMocks();

	mocks.requireSession.mockReturnValue({ walletAddress: WALLET });
	mocks.getChainConfig.mockReturnValue({
		name: "base",
		nativeTokenAddress: NATIVE_TOKEN,
		wrappedNativeAddress: WRAPPED_NATIVE,
		viemChain: {},
	});
	mocks.getWalletClient.mockReturnValue({
		sendTransaction: mocks.sendTransaction,
	});
	mocks.getPublicClient.mockReturnValue({
		estimateGas: mocks.estimateGas,
		waitForTransactionReceipt: mocks.waitForTransactionReceipt,
	});
	mocks.resolveToken
		.mockResolvedValueOnce({ address: TOKEN_IN, decimals: 6, symbol: "USDC" })
		.mockResolvedValueOnce({ address: TOKEN_OUT, decimals: 18, symbol: "WETH" });
	mocks.getRouteAndCallData.mockResolvedValue({
		route: {
			outputAmount: "500000000000000000",
		},
		calldata: {},
		router_address: ROUTER,
	});
	mocks.encodeSwapCalldata.mockReturnValue("0x1234");
	mocks.estimateGas.mockResolvedValue(150000n);
});

describe("handleSwapTokens simulation", () => {
	it("never broadcasts an ERC-20 approval when allowance is insufficient", async () => {
		mocks.getAllowance.mockResolvedValue(0n);

		const result = await handleSwapTokens({
			amount: "1",
			from_token: "USDC",
			to_token: "WETH",
			chain: "base",
			slippage: 1,
			simulate: true,
		});
		const payload = JSON.parse(result.content[0].text);

		expect(payload).toMatchObject({
			success: true,
			mode: "SIMULATION (no TX sent)",
			amountIn: "1",
			amountOut: "0.5",
			requiresApproval: true,
		});
		expect(payload).not.toHaveProperty("estimatedGas");
		expect(mocks.encodeApprove).not.toHaveBeenCalled();
		expect(mocks.sendTransaction).not.toHaveBeenCalled();
		expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
		expect(mocks.waitForAllowance).not.toHaveBeenCalled();
		expect(mocks.estimateGas).not.toHaveBeenCalled();
	});

	it("keeps the gas estimate when existing allowance is sufficient", async () => {
		mocks.getAllowance.mockResolvedValue(1_000_000n);

		const result = await handleSwapTokens({
			amount: "1",
			from_token: "USDC",
			to_token: "WETH",
			chain: "base",
			slippage: 1,
			simulate: true,
		});
		const payload = JSON.parse(result.content[0].text);

		expect(payload).toMatchObject({
			mode: "SIMULATION (no TX sent)",
			estimatedGas: "150000",
			requiresApproval: false,
		});
		expect(mocks.sendTransaction).not.toHaveBeenCalled();
		expect(mocks.estimateGas).toHaveBeenCalledOnce();
	});
});
