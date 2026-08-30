import { describe, expect, it } from "vitest";
import { ErrorCode, FibxError } from "../../lib/errors.js";
import { withErrorHandling } from "./error-handling.js";

/** The shape every MCP tool returns: one text block holding a JSON document. */
async function codeAndError(thrown: unknown): Promise<{ code: string; error: string }> {
	const handler = withErrorHandling(async () => {
		throw thrown;
	});
	const result = await handler();
	return JSON.parse(result.content[0]!.text) as { code: string; error: string };
}

describe("withErrorHandling", () => {
	it("reports a FibxError thrown directly with its own code", async () => {
		const { code } = await codeAndError(
			new FibxError(ErrorCode.POLICY_BLOCKED, "Transaction exceeds the per-transaction cap.")
		);

		expect(code).toBe("POLICY_BLOCKED");
	});

	/**
	 * The case that made this branch's refusals unreadable over MCP. The policy
	 * gate throws from inside the WalletConnect transport, so viem catches it
	 * and rethrows its own error with ours as the `cause`. Matching only the
	 * outermost error reported `UNKNOWN_ERROR` with no reason — an agent was
	 * told it failed but not that it had been refused, or why.
	 */
	it("reports a wrapped POLICY_BLOCKED with its real code, not UNKNOWN_ERROR", async () => {
		const inner = new FibxError(
			ErrorCode.POLICY_BLOCKED,
			"Transaction exceeds the per-transaction cap on base: 1 attempted, 0.05 allowed."
		);
		const wrapped = new Error("Transaction execution failed", {
			cause: new Error("An unknown RPC error occurred.", { cause: inner }),
		});

		const { code, error } = await codeAndError(wrapped);

		expect(code).toBe("POLICY_BLOCKED");
		expect(error).toContain("per-transaction cap");
	});

	// The same defect, pre-existing, for the other code the transports throw.
	it("reports a wrapped WALLET_ERROR with its real code", async () => {
		const inner = new FibxError(ErrorCode.WALLET_ERROR, "eth_sign is not available.");

		const { code } = await codeAndError(new Error("outer", { cause: inner }));

		expect(code).toBe("WALLET_ERROR");
	});

	it("still reports an ordinary error as UNKNOWN_ERROR", async () => {
		const { code } = await codeAndError(new Error("something else went wrong"));

		expect(code).toBe("UNKNOWN_ERROR");
	});

	it("carries a wrapped error's details through", async () => {
		const inner = new FibxError(ErrorCode.POLICY_BLOCKED, "refused", { rule: "maxValue" });

		const result = (await codeAndError(new Error("outer", { cause: inner }))) as {
			code: string;
			details?: unknown;
		};

		expect(result.details).toEqual({ rule: "maxValue" });
	});
});
