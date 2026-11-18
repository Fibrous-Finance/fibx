import { beforeEach, describe, expect, it, vi } from "vitest";
import { maxUint256 } from "viem";
import { ErrorCode } from "../../lib/errors.js";

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
}));

vi.mock("../auth/session.js", () => ({ requireSession: mocks.requireSession }));
vi.mock("../chain/constants.js", () => ({ getChainConfig: mocks.getChainConfig }));
vi.mock("../chain/client.js", () => ({
	getPublicClient: mocks.getPublicClient,
	getWalletClient: mocks.getWalletClient,
}));
vi.mock("../fibrous/tokens.js", () => ({ resolveToken: mocks.resolveToken }));
vi.mock("../fibrous/route.js", () => ({
	getRouteAndCallData: mocks.getRouteAndCallData,
	encodeSwapCalldata: mocks.encodeSwapCalldata,
}));
vi.mock("../chain/erc20.js", () => ({
	getAllowance: mocks.getAllowance,
	encodeApprove: mocks.encodeApprove,
	encodeDeposit: vi.fn(() => "0xd0e30db0"),
	encodeWithdraw: vi.fn(() => "0x2e1a7d4d"),
	waitForAllowance: mocks.waitForAllowance,
}));

import { executeSwap, SwapSimulationError } from "./swap.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const USDC = { address: "0x2222222222222222222222222222222222222222", decimals: 6, symbol: "USDC" };
const DAI = { address: "0x3333333333333333333333333333333333333333", decimals: 18, symbol: "DAI" };
const ROUTER = "0x4444444444444444444444444444444444444444";
const NATIVE = "0x0000000000000000000000000000000000000000";
const WRAPPED = "0x4200000000000000000000000000000000000006";
const ETH = { address: NATIVE, decimals: 18, symbol: "ETH" };
const WETH = { address: WRAPPED, decimals: 18, symbol: "WETH" };

function tokens(...list: (typeof USDC)[]) {
	mocks.resolveToken.mockReset();
	for (const token of list) mocks.resolveToken.mockResolvedValueOnce(token);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requireSession.mockReturnValue({ walletAddress: WALLET });
	mocks.getChainConfig.mockReturnValue({
		name: "base",
		nativeSymbol: "ETH",
		nativeTokenAddress: NATIVE,
		wrappedNativeAddress: WRAPPED,
		viemChain: {},
	});
	mocks.getWalletClient.mockResolvedValue({ sendTransaction: mocks.sendTransaction });
	mocks.getPublicClient.mockReturnValue({
		estimateGas: mocks.estimateGas,
		getGasPrice: mocks.getGasPrice,
		waitForTransactionReceipt: mocks.waitForTransactionReceipt,
	});
	tokens(USDC, DAI);
	mocks.getRouteAndCallData.mockResolvedValue({
		route: { outputAmount: "500000000000000000" },
		calldata: {},
		router_address: ROUTER,
	});
	mocks.encodeSwapCalldata.mockReturnValue("0x1234");
	mocks.estimateGas.mockResolvedValue(150000n);
	mocks.getGasPrice.mockResolvedValue(1_000_000_000n);
	mocks.getAllowance.mockResolvedValue(10n ** 30n);
	mocks.sendTransaction.mockResolvedValue("0xhash");
	mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 1n });
});

const request = { amount: "1", from: "USDC", to: "DAI", chain: "base", slippage: 1 };

// Only swap_tokens refused this; `fibx trade USDC USDC` went to the router.
describe("a swap from a token to itself", () => {
	it("is refused by name before a session or an RPC is touched", async () => {
		await expect(executeSwap({ ...request, to: "usdc" })).rejects.toMatchObject({
			code: ErrorCode.VALIDATION_ERROR,
		});
		expect(mocks.requireSession).not.toHaveBeenCalled();
		expect(mocks.sendTransaction).not.toHaveBeenCalled();
	});

	it("is refused when two names resolve to the same token", async () => {
		tokens(USDC, USDC);

		await expect(
			executeSwap({ ...request, to: USDC.address, simulate: false })
		).rejects.toThrow("Source and destination tokens cannot be the same.");
		expect(mocks.getRouteAndCallData).not.toHaveBeenCalled();
		expect(mocks.sendTransaction).not.toHaveBeenCalled();
	});
});

// swap_tokens relied on its tool schema for this, but its handler is also
// reached without one.
describe("slippage", () => {
	it.each([0, 50.5, Number.NaN])("refuses %s before anything else runs", async (slippage) => {
		await expect(executeSwap({ ...request, slippage })).rejects.toMatchObject({
			code: ErrorCode.VALIDATION_ERROR,
		});
		expect(mocks.requireSession).not.toHaveBeenCalled();
		expect(mocks.getRouteAndCallData).not.toHaveBeenCalled();
	});

	it("defaults when omitted and reaches the route", async () => {
		await executeSwap({ ...request, slippage: undefined, simulate: true });

		expect(mocks.getRouteAndCallData).toHaveBeenCalledWith(
			expect.objectContaining({ slippage: 0.5 }),
			expect.anything()
		);
	});
});

// swap_tokens answered success: true for a simulated wrap without asking the
// chain anything, so an unaffordable wrap "simulated" fine.
describe("a simulated wrap or unwrap", () => {
	it("estimates gas for a wrap and sends nothing", async () => {
		tokens(ETH, WETH);

		const outcome = await executeSwap({ ...request, from: "ETH", to: "WETH", simulate: true });

		expect(outcome).toMatchObject({ simulated: true, operation: "wrap", gas: 150000n });
		expect(mocks.estimateGas).toHaveBeenCalledWith(
			expect.objectContaining({ to: WRAPPED, value: 10n ** 18n })
		);
		expect(mocks.sendTransaction).not.toHaveBeenCalled();
	});

	it("estimates gas for an unwrap", async () => {
		tokens(WETH, ETH);

		const outcome = await executeSwap({ ...request, from: "WETH", to: "ETH", simulate: true });

		expect(outcome).toMatchObject({ simulated: true, operation: "unwrap", gas: 150000n });
		expect(mocks.estimateGas).toHaveBeenCalledWith(
			expect.objectContaining({ to: WRAPPED, value: 0n })
		);
	});

	it("fails as a simulation failure when the estimate reverts", async () => {
		tokens(ETH, WETH);
		mocks.estimateGas.mockRejectedValue(new Error("insufficient funds for gas"));

		await expect(
			executeSwap({ ...request, from: "ETH", to: "WETH", simulate: true })
		).rejects.toThrow("Simulation failed: insufficient funds for gas");
	});
});

// The CLI said "Simulation failed: …"; swap_tokens threw viem's error as is.
describe("a failed swap gas estimate", () => {
	it("is a SwapSimulationError on every surface, and nothing is sent", async () => {
		mocks.estimateGas.mockRejectedValue(new Error("execution reverted"));

		const attempt = executeSwap({ ...request, simulate: false });

		await expect(attempt).rejects.toBeInstanceOf(SwapSimulationError);
		await expect(attempt).rejects.toThrow("Simulation failed: execution reverted");
		expect(mocks.sendTransaction).not.toHaveBeenCalled();
	});
});

describe("the fee", () => {
	it("is priced only when asked for", async () => {
		const quiet = await executeSwap({ ...request, simulate: true });
		expect(quiet).toMatchObject({ gas: 150000n });
		expect(quiet).not.toHaveProperty("feeWei", expect.anything());
		expect(mocks.getGasPrice).not.toHaveBeenCalled();

		tokens(USDC, DAI);
		const priced = await executeSwap({ ...request, simulate: true, quoteFee: true });
		expect(priced).toMatchObject({ gas: 150000n, feeWei: 150000n * 1_000_000_000n });
	});
});

describe("approval", () => {
	beforeEach(() => mocks.getAllowance.mockResolvedValue(0n));

	it("approves the exact amount by default", async () => {
		await executeSwap(request);

		expect(mocks.encodeApprove).toHaveBeenCalledWith(ROUTER, 1_000_000n);
		expect(mocks.waitForAllowance).toHaveBeenCalledWith(
			expect.anything(),
			USDC.address,
			WALLET,
			ROUTER,
			1_000_000n
		);
	});

	it("approves maxUint256 with approveMax", async () => {
		await executeSwap({ ...request, approveMax: true });

		expect(mocks.encodeApprove).toHaveBeenCalledWith(ROUTER, maxUint256);
	});
});

/**
 * The broadcast path, end to end through mocked clients. Every other test in
 * this repo stopped at simulate: true, so nothing pinned what is actually
 * signed — who the approval names as spender, where the swap goes, and with
 * how much value.
 */
describe("execution", () => {
	const ROUTE_CALLDATA = { route: { token_in: USDC.address }, swap_parameters: [] };

	beforeEach(() => {
		mocks.getRouteAndCallData.mockResolvedValue({
			route: { outputAmount: "500000000000000000" },
			calldata: ROUTE_CALLDATA,
			router_address: ROUTER,
		});
		mocks.encodeApprove.mockReturnValue("0xapprove");
		mocks.encodeSwapCalldata.mockReturnValue("0xswapdata");
		mocks.sendTransaction
			.mockReset()
			.mockResolvedValueOnce("0xapprovehash")
			.mockResolvedValueOnce("0xswaphash");
	});

	it("approves the router for the exact amount, waits, then swaps through the router", async () => {
		mocks.getAllowance.mockResolvedValue(0n);

		const outcome = await executeSwap(request);

		expect(mocks.getRouteAndCallData).toHaveBeenCalledWith(
			{
				amount: "1000000",
				tokenInAddress: USDC.address,
				tokenOutAddress: DAI.address,
				slippage: 1,
				destination: WALLET,
			},
			expect.anything()
		);
		expect(mocks.encodeApprove).toHaveBeenCalledWith(ROUTER, 1_000_000n);
		expect(mocks.sendTransaction).toHaveBeenNthCalledWith(1, {
			to: USDC.address,
			data: "0xapprove",
			value: 0n,
		});
		// The swap is built only after the approval's receipt succeeded and
		// the allowance is visible.
		expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(
			expect.objectContaining({ hash: "0xapprovehash" })
		);
		expect(mocks.waitForTransactionReceipt.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.sendTransaction.mock.invocationCallOrder[1]
		);
		expect(mocks.waitForAllowance).toHaveBeenCalledWith(
			expect.anything(),
			USDC.address,
			WALLET,
			ROUTER,
			1_000_000n
		);
		expect(mocks.encodeSwapCalldata).toHaveBeenCalledWith(ROUTE_CALLDATA, expect.anything());
		expect(mocks.sendTransaction).toHaveBeenNthCalledWith(2, {
			to: ROUTER,
			data: "0xswapdata",
			value: 0n,
		});
		// The service does not wait for the swap's own receipt: swap_tokens
		// returns the hash at once, and `fibx trade` waits in the command.
		expect(mocks.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
		expect(outcome).toMatchObject({ simulated: false, hash: "0xswaphash", router: ROUTER });
	});

	it("stops at a reverted approval and sends no swap", async () => {
		mocks.getAllowance.mockResolvedValue(0n);
		mocks.waitForTransactionReceipt.mockResolvedValue({ status: "reverted", blockNumber: 2n });

		await expect(executeSwap(request)).rejects.toMatchObject({
			code: ErrorCode.TX_REVERTED,
			details: { txHash: "0xapprovehash" },
		});
		expect(mocks.waitForAllowance).not.toHaveBeenCalled();
		expect(mocks.sendTransaction).toHaveBeenCalledTimes(1);
	});

	it("sends a native-input swap with the amount as value and no approval", async () => {
		tokens(ETH, USDC);
		mocks.sendTransaction.mockReset().mockResolvedValueOnce("0xswaphash");

		const outcome = await executeSwap({ ...request, from: "ETH", to: "USDC" });

		expect(mocks.getAllowance).not.toHaveBeenCalled();
		expect(mocks.encodeApprove).not.toHaveBeenCalled();
		expect(mocks.estimateGas).toHaveBeenCalledWith({
			account: WALLET,
			to: ROUTER,
			data: "0xswapdata",
			value: 10n ** 18n,
		});
		expect(mocks.sendTransaction).toHaveBeenCalledOnce();
		expect(mocks.sendTransaction).toHaveBeenCalledWith({
			to: ROUTER,
			data: "0xswapdata",
			value: 10n ** 18n,
		});
		expect(outcome).toMatchObject({ simulated: false, hash: "0xswaphash" });
	});
});
