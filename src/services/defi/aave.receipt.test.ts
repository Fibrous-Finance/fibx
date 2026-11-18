import { describe, expect, it, vi } from "vitest";
import type { WalletClient } from "viem";
import { AaveService } from "./aave.js";
import { SUPPORTED_CHAINS } from "../chain/constants.js";
import { ErrorCode } from "../../lib/errors.js";

const ACCOUNT = { address: "0x1111111111111111111111111111111111111111" };
const TOKEN = "0x2222222222222222222222222222222222222222";

/**
 * Every Aave write awaited its receipt but never read its status, so a
 * reverted borrow came back as a hash — and `fibx aave borrow` printed
 * "Borrow confirmed".
 */
describe("AaveService receipts", () => {
	function serviceWithReceipt(status: "success" | "reverted") {
		const service = new AaveService(SUPPORTED_CHAINS.base!);
		service.setWalletClient(
			{
				account: ACCOUNT,
				writeContract: vi.fn().mockResolvedValue("0xborrow"),
			} as unknown as WalletClient,
			// No nonce manager: it would read the chain.
			{ managesOwnNonce: true }
		);
		// The service builds its own public client; replace it so nothing
		// reaches an RPC.
		Object.assign(service, {
			publicClient: {
				readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
					functionName === "decimals" ? 6 : "0x3333333333333333333333333333333333333333"
				),
				simulateContract: vi.fn().mockResolvedValue({ request: {} }),
				waitForTransactionReceipt: vi.fn().mockResolvedValue({ status, blockNumber: 3n }),
			},
		});
		return service;
	}

	it("fails a reverted borrow with TX_REVERTED", async () => {
		await expect(serviceWithReceipt("reverted").borrow(TOKEN, "1")).rejects.toMatchObject({
			code: ErrorCode.TX_REVERTED,
			details: { txHash: "0xborrow" },
		});
	});

	it("returns the hash of a successful borrow", async () => {
		await expect(serviceWithReceipt("success").borrow(TOKEN, "1")).resolves.toBe("0xborrow");
	});
});
