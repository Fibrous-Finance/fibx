import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireSession: vi.fn(),
	getChainConfig: vi.fn(),
	sendTransaction: vi.fn(),
	writeContract: vi.fn(),
	estimateGas: vi.fn(),
	waitForTransactionReceipt: vi.fn(),
	outputResult: vi.fn(),
	spinner: {
		text: "",
		start: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		warn: vi.fn(),
	},
}));

vi.mock("../../services/auth/session.js", () => ({ requireSession: mocks.requireSession }));
vi.mock("../../services/chain/constants.js", () => ({ getChainConfig: mocks.getChainConfig }));
vi.mock("../../services/chain/client.js", () => ({
	getWalletClient: vi.fn(async () => ({
		sendTransaction: mocks.sendTransaction,
		writeContract: mocks.writeContract,
	})),
	getPublicClient: vi.fn(() => ({
		estimateGas: mocks.estimateGas,
		waitForTransactionReceipt: mocks.waitForTransactionReceipt,
	})),
}));
vi.mock("../../services/fibrous/tokens.js", () => ({ resolveToken: vi.fn() }));
vi.mock("../../lib/format.js", () => ({
	createSpinner: vi.fn(() => mocks.spinner),
	outputResult: mocks.outputResult,
	outputError: vi.fn(() => {
		process.exitCode = 1;
	}),
	formatError: vi.fn((error: unknown) => String(error)),
}));

import { sendCommand } from "./send.js";
import { WaitForTransactionReceiptTimeoutError } from "viem";
import { outputError } from "../../lib/format.js";
import { ErrorCode } from "../../lib/errors.js";

const RECIPIENT = "0x2222222222222222222222222222222222222222";
const previousExitCode = process.exitCode;

beforeEach(() => {
	vi.clearAllMocks();
	process.exitCode = undefined;
	mocks.spinner.start.mockReturnValue(mocks.spinner);
	mocks.requireSession.mockReturnValue({
		walletAddress: "0x1111111111111111111111111111111111111111",
	});
	mocks.getChainConfig.mockReturnValue({ name: "base", nativeSymbol: "ETH", viemChain: {} });
	mocks.estimateGas.mockResolvedValue(21000n);
	mocks.sendTransaction.mockResolvedValue("0xsend");
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	process.exitCode = previousExitCode;
});

// "Transfer confirmed" used to print as soon as the hash came back.
describe("sendCommand", () => {
	it("says confirmed only after a successful receipt", async () => {
		mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 1n });

		await sendCommand("0.1", RECIPIENT, "", { json: true });

		expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(
			expect.objectContaining({ hash: "0xsend" })
		);
		expect(mocks.spinner.succeed).toHaveBeenCalledWith("Transfer confirmed");
		expect(mocks.outputResult).toHaveBeenCalledWith(
			expect.objectContaining({ txHash: "0xsend" }),
			{ json: true }
		);
		expect(process.exitCode).toBeUndefined();
	});

	it("reports a reverted transfer as a failure and exits non-zero", async () => {
		mocks.waitForTransactionReceipt.mockResolvedValue({ status: "reverted", blockNumber: 1n });

		await sendCommand("0.1", RECIPIENT, "", { json: true });

		expect(mocks.spinner.succeed).not.toHaveBeenCalledWith("Transfer confirmed");
		expect(mocks.outputResult).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	});

	// A timeout says nothing about the outcome; the line must not call it failed.
	it("labels a transfer with no receipt yet as unconfirmed, not failed", async () => {
		mocks.waitForTransactionReceipt.mockRejectedValue(
			new WaitForTransactionReceiptTimeoutError({ hash: "0xsend" })
		);

		await sendCommand("0.1", RECIPIENT, "", { json: true });

		expect(mocks.spinner.warn).toHaveBeenCalledWith("Sent, but not confirmed yet");
		expect(mocks.spinner.fail).not.toHaveBeenCalledWith("Transfer failed");
		expect(vi.mocked(outputError)).toHaveBeenCalledWith(
			expect.objectContaining({ code: ErrorCode.TX_UNCONFIRMED }),
			{ json: true }
		);
		expect(process.exitCode).toBe(1);
	});
});
