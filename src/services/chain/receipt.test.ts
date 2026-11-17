import { describe, expect, it, vi } from "vitest";
import { WaitForTransactionReceiptTimeoutError } from "viem";
import { ErrorCode } from "../../lib/errors.js";
import { RECEIPT_TIMEOUT_MS, waitForSuccess } from "./receipt.js";

const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001";

function clientReturning(result: unknown) {
	const waitForTransactionReceipt = vi.fn(async () => {
		if (result instanceof Error) throw result;
		return result;
	});
	// Only the method waitForSuccess calls; the rest of a PublicClient is noise.
	const client = { waitForTransactionReceipt } as never;
	return { client, waitForTransactionReceipt };
}

describe("waitForSuccess", () => {
	it("returns a successful receipt, with the timeout bounded", async () => {
		const { client, waitForTransactionReceipt } = clientReturning({
			status: "success",
			blockNumber: 7n,
		});

		await expect(waitForSuccess(client, HASH, "Swap")).resolves.toMatchObject({
			status: "success",
		});
		expect(waitForTransactionReceipt).toHaveBeenCalledWith({
			hash: HASH,
			confirmations: 1,
			timeout: RECEIPT_TIMEOUT_MS,
		});
	});

	// viem resolves for a reverted transaction; the status is only a field.
	it("fails a reverted receipt with TX_REVERTED and the hash", async () => {
		const { client } = clientReturning({ status: "reverted", blockNumber: 7n });
		const attempt = waitForSuccess(client, HASH, "Swap");

		await expect(attempt).rejects.toMatchObject({
			code: ErrorCode.TX_REVERTED,
			details: { txHash: HASH, blockNumber: "7" },
		});
		await expect(attempt).rejects.toThrow(`Swap transaction ${HASH} reverted in block 7`);
	});

	it("reports a timeout as unconfirmed, not as either outcome", async () => {
		const { client } = clientReturning(
			new WaitForTransactionReceiptTimeoutError({ hash: HASH })
		);
		const attempt = waitForSuccess(client, HASH, "Transfer");

		await expect(attempt).rejects.toMatchObject({ code: ErrorCode.TX_UNCONFIRMED });
		await expect(attempt).rejects.toThrow(/may still confirm or revert/);
	});

	it("passes any other failure through", async () => {
		const { client } = clientReturning(new Error("rpc down"));

		await expect(waitForSuccess(client, HASH, "Swap")).rejects.toThrow("rpc down");
	});
});
