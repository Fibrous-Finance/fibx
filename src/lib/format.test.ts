import { describe, expect, it } from "vitest";
import { formatError } from "./format.js";
import { ErrorCode, FibxError } from "./errors.js";

/**
 * The WalletConnect provider throws from inside viem's transport, and viem wraps
 * whatever it catches: TransactionExecutionError <- UnknownRpcError <- FibxError.
 * So on the signing path the typed error this codebase guarantees is never the
 * top-level one. Before formatError walked the chain, it fell through to
 * parseEvmError — which matches no WalletConnect pattern and truncates — and the
 * user saw "An unknown RPC error occurred. Details: Your wallet did n…", with the
 * chain unnamed and the instruction cut mid-word.
 */
describe("formatError", () => {
	it("formats a bare FibxError with its code", () => {
		const out = formatError(
			new FibxError(ErrorCode.WALLET_ERROR, "Wallet rejected the request")
		);

		expect(out).toContain("[WALLET_ERROR]");
		expect(out).toContain("Wallet rejected the request");
	});

	it("finds a FibxError one level down the cause chain", () => {
		const inner = new FibxError(
			ErrorCode.UNSUPPORTED_CHAIN,
			"Your wallet did not approve monad for this session."
		);

		const out = formatError(new Error("An unknown RPC error occurred.", { cause: inner }));

		expect(out).toContain("[UNSUPPORTED_CHAIN]");
		expect(out).toContain("monad");
	});

	// The shape viem actually produces on the signing path.
	it("finds a FibxError two levels down", () => {
		const inner = new FibxError(
			ErrorCode.UNSUPPORTED_CHAIN,
			"Your wallet did not approve monad for this session."
		);
		const rpc = new Error("An unknown RPC error occurred.", { cause: inner });

		const out = formatError(new Error("Transaction execution failed", { cause: rpc }));

		expect(out).toContain("[UNSUPPORTED_CHAIN]");
		expect(out).toContain("monad");
	});

	// Every command in the CLI formats its errors here, so the fallback matters
	// as much as the new path.
	it("still routes an error with no FibxError in its chain to parseEvmError", () => {
		const out = formatError(new Error("execution reverted: bad params"));

		expect(out).toContain("Transaction would fail on-chain");
		expect(out).not.toMatch(/\[[A-Z_]+\]/);
	});

	it("terminates on a cyclic cause chain", () => {
		const first = new Error("first");
		const second = new Error("second", { cause: first });
		(first as { cause?: unknown }).cause = second;

		expect(() => formatError(first)).not.toThrow();
	});
});
