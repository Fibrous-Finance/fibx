import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
	getGasPrice: vi.fn(),
	outputResult: vi.fn(),
	createSpinner: vi.fn(),
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

vi.mock("../../lib/format.js", () => ({
	createSpinner: mocks.createSpinner,
	outputResult: mocks.outputResult,
	formatError: vi.fn((error: unknown) => String(error)),
}));

import { tradeCommand } from "./swap.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const TOKEN_IN = "0x2222222222222222222222222222222222222222";
const TOKEN_OUT = "0x3333333333333333333333333333333333333333";
const ROUTER = "0x4444444444444444444444444444444444444444";
const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";
const WRAPPED_NATIVE = "0x4200000000000000000000000000000000000006";
const previousExitCode = process.exitCode;

beforeEach(() => {
	vi.clearAllMocks();
	process.exitCode = undefined;

	mocks.createSpinner.mockImplementation((text: string) => {
		const spinner = {
			text,
			start: vi.fn(),
			stop: vi.fn(),
			succeed: vi.fn(),
			fail: vi.fn(),
		};
		spinner.start.mockReturnValue(spinner);
		spinner.stop.mockReturnValue(spinner);
		spinner.succeed.mockReturnValue(spinner);
		spinner.fail.mockReturnValue(spinner);
		return spinner;
	});
	mocks.requireSession.mockReturnValue({ walletAddress: WALLET });
	mocks.getChainConfig.mockReturnValue({
		name: "base",
		nativeSymbol: "ETH",
		nativeTokenAddress: NATIVE_TOKEN,
		wrappedNativeAddress: WRAPPED_NATIVE,
		viemChain: {},
	});
	mocks.getWalletClient.mockReturnValue({
		sendTransaction: mocks.sendTransaction,
	});
	mocks.getPublicClient.mockReturnValue({
		estimateGas: mocks.estimateGas,
		getGasPrice: mocks.getGasPrice,
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
	mocks.getGasPrice.mockResolvedValue(1_000_000_000n);
});

afterEach(() => {
	process.exitCode = previousExitCode;
});

describe("tradeCommand simulation", () => {
	it("never broadcasts an ERC-20 approval when allowance is insufficient", async () => {
		mocks.getAllowance.mockResolvedValue(0n);
		const opts = {
			slippage: 1,
			approveMax: true,
			simulate: true,
			json: true,
			chain: "base",
		};

		await tradeCommand("1", "USDC", "WETH", opts);

		expect(mocks.outputResult).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "SIMULATION (no TX sent)",
				input: "1 USDC",
				output: "~0.5 WETH",
				requiresApproval: true,
			}),
			opts
		);
		const output = mocks.outputResult.mock.calls[0][0];
		expect(output).not.toHaveProperty("estimatedGas");
		expect(mocks.createSpinner).not.toHaveBeenCalledWith("Approving token spend...");
		expect(mocks.encodeApprove).not.toHaveBeenCalled();
		expect(mocks.sendTransaction).not.toHaveBeenCalled();
		expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
		expect(mocks.waitForAllowance).not.toHaveBeenCalled();
		expect(mocks.estimateGas).not.toHaveBeenCalled();
		expect(process.exitCode).toBeUndefined();
	});

	it("keeps the gas estimate when existing allowance is sufficient", async () => {
		mocks.getAllowance.mockResolvedValue(1_000_000n);
		const opts = {
			slippage: 1,
			simulate: true,
			json: true,
			chain: "base",
		};

		await tradeCommand("1", "USDC", "WETH", opts);

		expect(mocks.outputResult).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "SIMULATION (no TX sent)",
				estimatedGas: "0.00015 ETH",
				requiresApproval: false,
			}),
			opts
		);
		expect(mocks.sendTransaction).not.toHaveBeenCalled();
		expect(mocks.estimateGas).toHaveBeenCalledOnce();
		expect(process.exitCode).toBeUndefined();
	});
});
