import type { Address, PublicClient } from "viem";

/**
 * Serializes transaction broadcasts so two of them cannot claim the same nonce.
 *
 * The nonce is read from the chain's *pending* count on every send rather than
 * cached and incremented locally. That matters because this manager does not
 * see every transaction the process makes — swap and send let viem assign their
 * own nonces. A cached counter drifts the moment one of those lands, and the
 * next managed transaction fails as "nonce too low".
 *
 * Reading pending each time also self-heals the opposite case: if a broadcast
 * fails, the pending count never moved, so the same nonce is handed out again
 * instead of leaving a permanent gap.
 *
 * The lock spans read-and-broadcast, not just the read — releasing it earlier
 * would let a concurrent caller observe the same pending count before this
 * transaction reached the mempool.
 */
export class NonceManager {
	private static instance: NonceManager;
	private mutex: Promise<void> = Promise.resolve();

	private constructor() {}

	public static getInstance(): NonceManager {
		if (!NonceManager.instance) {
			NonceManager.instance = new NonceManager();
		}
		return NonceManager.instance;
	}

	/**
	 * Acquires the lock, resolves the next nonce, and runs `send` with it.
	 * Whatever `send` returns is passed through; the lock is always released.
	 */
	public async withNonce<T>(
		address: Address,
		publicClient: PublicClient,
		send: (nonce: number) => Promise<T>
	): Promise<T> {
		let release!: () => void;
		const lock = new Promise<void>((resolve) => {
			release = resolve;
		});

		const previous = this.mutex;
		this.mutex = this.mutex.then(() => lock);
		await previous;

		try {
			const nonce = await publicClient.getTransactionCount({
				address,
				blockTag: "pending",
			});
			return await send(nonce);
		} finally {
			release();
		}
	}
}
