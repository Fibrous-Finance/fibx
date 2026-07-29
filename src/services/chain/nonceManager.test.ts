import { describe, it, expect, vi } from "vitest";
import type { Address, PublicClient } from "viem";
import { NonceManager } from "./nonceManager.js";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;

/**
 * Stands in for a chain: `pending` counts confirmed + in-flight transactions,
 * so broadcasting is what advances it.
 */
function stubChain(startNonce = 0) {
	let pending = startNonce;
	const client = {
		getTransactionCount: vi.fn(async () => pending),
	} as unknown as PublicClient;

	return {
		client,
		broadcast: () => {
			pending++;
		},
		get pending() {
			return pending;
		},
	};
}

describe("NonceManager.withNonce", () => {
	it("reads the pending nonce from the chain on every send", async () => {
		const chain = stubChain(7);
		const manager = NonceManager.getInstance();

		const first = await manager.withNonce(WALLET, chain.client, async (nonce) => {
			chain.broadcast();
			return nonce;
		});
		const second = await manager.withNonce(WALLET, chain.client, async (nonce) => {
			chain.broadcast();
			return nonce;
		});

		expect(first).toBe(7);
		expect(second).toBe(8);
		expect(chain.client.getTransactionCount).toHaveBeenCalledWith({
			address: WALLET,
			blockTag: "pending",
		});
	});

	// Regression: the manager only sees Aave transactions. Swap and send assign
	// their own nonces, and the old cached counter never noticed — the next
	// managed transaction then reused a spent nonce and failed "nonce too low".
	it("picks up transactions sent outside the manager", async () => {
		const chain = stubChain(3);
		const manager = NonceManager.getInstance();

		await manager.withNonce(WALLET, chain.client, async () => chain.broadcast());

		// Something else (a swap via viem) broadcasts twice.
		chain.broadcast();
		chain.broadcast();

		const next = await manager.withNonce(WALLET, chain.client, async (nonce) => nonce);
		expect(next).toBe(6);
	});

	// The mirror case: a cached counter that advanced past a failed broadcast
	// left a permanent gap. Reading pending each time reuses the nonce instead.
	it("reuses the nonce after a failed broadcast", async () => {
		const chain = stubChain(4);
		const manager = NonceManager.getInstance();

		await expect(
			manager.withNonce(WALLET, chain.client, async () => {
				throw new Error("broadcast rejected");
			})
		).rejects.toThrow("broadcast rejected");

		const next = await manager.withNonce(WALLET, chain.client, async (nonce) => nonce);
		expect(next).toBe(4);
	});

	// The lock has to span read-and-broadcast. If it were released after the
	// read, both callers would observe the same pending count and collide.
	it("never hands the same nonce to concurrent senders", async () => {
		const chain = stubChain(0);
		const manager = NonceManager.getInstance();

		const send = () =>
			manager.withNonce(WALLET, chain.client, async (nonce) => {
				// Yield so a poorly-scoped lock would let the other caller in here.
				await new Promise((resolve) => setTimeout(resolve, 5));
				chain.broadcast();
				return nonce;
			});

		const nonces = await Promise.all([send(), send(), send(), send()]);

		expect([...nonces].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
		expect(new Set(nonces).size).toBe(4);
	});

	it("releases the lock when a send throws so later sends still work", async () => {
		const chain = stubChain(0);
		const manager = NonceManager.getInstance();

		const failing = manager
			.withNonce(WALLET, chain.client, async () => {
				throw new Error("boom");
			})
			.catch(() => "failed");

		const following = manager.withNonce(WALLET, chain.client, async (nonce) => {
			chain.broadcast();
			return nonce;
		});

		expect(await failing).toBe("failed");
		expect(await following).toBe(0);
	});
});
