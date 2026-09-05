import { describe, expect, it } from "vitest";
import { explainError } from "./errors.js";
import { ToolError } from "./rpc.js";

const ctx = { symbol: "ETH", amount: "0.0005", balance: "0.0002" };

describe("explainError", () => {
	// The one the first real use hit: an eth_estimateGas dump in red.
	it("names an insufficient balance from the amounts, not the RPC body", () => {
		const e = new Error(
			'Transaction creation failed. URL: https://mainnet.base.org Request body: {"method":"eth_estimateGas","params":[...]}'
		);
		const x = explainError(e, ctx);
		expect(x.title).toBe("Insufficient balance");
		expect(x.detail).toBe("You have 0.0002 ETH; this needs 0.0005.");
		expect(x.severity).toBe("error");
	});

	it("names a policy refusal and points at the section", () => {
		const e = new ToolError("Blocked by signing policy: base.maxValue", "POLICY_BLOCKED", "x", {
			rule: "base.maxValue",
		});
		const x = explainError(e, {});
		expect(x.title).toBe("Blocked by your signing policy");
		expect(x.detail).toContain("base.maxValue");
		expect(x.action).toBe("policy");
	});

	it("names a wallet rejection and says nothing was sent", () => {
		const x = explainError(
			new Error("UserRejectedRequestError: User rejected the request"),
			{}
		);
		expect(x.title).toBe("Rejected in your wallet");
		expect(x.detail).toBe("Nothing was sent.");
	});

	it("names a moved price", () => {
		const x = explainError(new Error("execution reverted: INSUFFICIENT_OUTPUT_AMOUNT"), {});
		expect(x.title).toBe("The price moved");
		expect(x.action).toBe("requote");
	});

	it("names an unknown token from the code", () => {
		const e = new ToolError(
			"Token not found: XYZ",
			"TOKEN_NOT_SUPPORTED",
			undefined,
			undefined
		);
		const x = explainError(e, { symbol: "XYZ" });
		expect(x.title).toBe('"XYZ" is not on this chain');
		expect(x.action).toBe("pick");
	});

	// Anything unmapped: a short first line, and the raw text kept for the
	// disclosure — never lost, never the headline.
	it("keeps the raw text in detail for an unknown error", () => {
		const raw = "Something odd happened\nwith many lines";
		const x = explainError(new Error(raw), {});
		expect(x.title).toBe("Something odd happened");
		expect(x.raw).toBe(raw);
	});

	it("does not call it a balance problem when the amount fits the balance", () => {
		const x = explainError(new Error("eth_estimateGas failed"), {
			symbol: "ETH",
			amount: "0.0001",
			balance: "0.0002",
		});
		expect(x.title).not.toBe("Insufficient balance");
	});

	it("never puts an estimateGas dump in the headline", () => {
		const raw =
			'Transaction creation failed. URL: https://mainnet.base.org Request body: {"method":"eth_estimateGas","params":[...]}';
		const x = explainError(new Error(raw), {
			symbol: "ETH",
			amount: "0.0001",
			balance: "0.0002",
		});
		expect(x.title).toBe("The simulation failed");
		expect(x.title).not.toContain("mainnet.base.org");
		expect(x.raw).toBe(raw);
		expect(x.detail).toContain("gas");
	});
});
