import { describe, it, expect, vi } from "vitest";
import type { Address, PublicClient } from "viem";
import { waitForAllowance } from "./erc20.js";
import { FibxError, ErrorCode } from "../../lib/errors.js";

const TOKEN = "0x4200000000000000000000000000000000000006" as Address;
const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const SPENDER = "0x2222222222222222222222222222222222222222" as Address;

/** Minimal stand-in for viem's PublicClient — waitForAllowance only reads. */
function stubClient(allowances: bigint[]): PublicClient {
	const readContract = vi.fn();
	for (const value of allowances) {
		readContract.mockResolvedValueOnce(value);
	}
	// Anything past the scripted sequence keeps returning the last value.
	readContract.mockResolvedValue(allowances[allowances.length - 1] ?? 0n);
	return { readContract } as unknown as PublicClient;
}

describe("waitForAllowance", () => {
	it("resolves once the allowance reaches the target", async () => {
		const client = stubClient([1000n]);

		await expect(
			waitForAllowance(client, TOKEN, OWNER, SPENDER, 1000n, 3, 1)
		).resolves.toBeUndefined();

		expect(client.readContract).toHaveBeenCalledTimes(1);
	});

	it("keeps polling while the approval is still propagating", async () => {
		const client = stubClient([0n, 0n, 500n]);

		await expect(
			waitForAllowance(client, TOKEN, OWNER, SPENDER, 500n, 5, 1)
		).resolves.toBeUndefined();

		expect(client.readContract).toHaveBeenCalledTimes(3);
	});

	// Regression: this used to fall out of the loop and return silently, letting
	// the caller send a swap that was guaranteed to revert and burn gas.
	it("throws instead of returning silently when the approval never lands", async () => {
		const client = stubClient([0n]);

		await expect(waitForAllowance(client, TOKEN, OWNER, SPENDER, 1000n, 3, 1)).rejects.toThrow(
			FibxError
		);
	});

	it("reports the observed and required allowance in the error", async () => {
		const client = stubClient([250n]);

		try {
			await waitForAllowance(client, TOKEN, OWNER, SPENDER, 1000n, 2, 1);
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(FibxError);
			const err = error as FibxError;
			expect(err.code).toBe(ErrorCode.RPC_ERROR);
			expect(err.message).toContain("250");
			expect(err.message).toContain("1000");
		}
	});
});
