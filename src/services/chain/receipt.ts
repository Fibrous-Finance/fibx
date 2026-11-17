import {
	WaitForTransactionReceiptTimeoutError,
	type Hash,
	type PublicClient,
	type TransactionReceipt,
} from "viem";
import { ErrorCode, FibxError } from "../../lib/errors.js";

/**
 * How long a CLI write waits for its receipt. viem's own default, stated so
 * the bound is visible: approvals already waited this long, implicitly.
 */
export const RECEIPT_TIMEOUT_MS = 180_000;

/**
 * Waits for a transaction's receipt and fails unless it succeeded.
 *
 * viem's waitForTransactionReceipt resolves for a reverted transaction too —
 * the status is a field on the receipt, not an error — so every caller that
 * awaited it and then reported success could report a revert as "confirmed".
 * A timeout is reported as unknown rather than as either outcome: the
 * transaction may still land.
 */
export async function waitForSuccess(
	client: Pick<PublicClient, "waitForTransactionReceipt">,
	hash: Hash,
	what: string
): Promise<TransactionReceipt> {
	let receipt: TransactionReceipt;
	try {
		receipt = await client.waitForTransactionReceipt({
			hash,
			confirmations: 1,
			timeout: RECEIPT_TIMEOUT_MS,
		});
	} catch (error) {
		if (error instanceof WaitForTransactionReceiptTimeoutError) {
			throw new FibxError(
				ErrorCode.TX_UNCONFIRMED,
				`${what} transaction ${hash} was sent but not confirmed within ${RECEIPT_TIMEOUT_MS / 1000}s. ` +
					"It may still confirm or revert — check it with `fibx tx-status` before retrying.",
				{ txHash: hash },
				{ cause: error }
			);
		}
		throw error;
	}

	if (receipt.status !== "success") {
		throw new FibxError(
			ErrorCode.TX_REVERTED,
			`${what} transaction ${hash} reverted in block ${receipt.blockNumber}. ` +
				"Nothing changed hands except the gas it spent.",
			{ txHash: hash, blockNumber: receipt.blockNumber.toString() }
		);
	}
	return receipt;
}
