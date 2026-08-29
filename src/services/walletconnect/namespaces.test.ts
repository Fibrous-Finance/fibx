import { describe, expect, it } from "vitest";
import {
	buildOptionalNamespaces,
	caip2,
	firstAccountAddress,
	sessionHasChain,
} from "./namespaces.js";

describe("caip2", () => {
	it("formats a chain id", () => {
		expect(caip2(8453)).toBe("eip155:8453");
	});
});

describe("buildOptionalNamespaces", () => {
	it("covers every offered chain", () => {
		const ns = buildOptionalNamespaces();
		expect(ns.eip155.chains.sort()).toEqual(["eip155:143", "eip155:8453", "eip155:999"].sort());
	});

	// eth_signTransaction is deliberately absent: MetaMask does not implement it
	// over WalletConnect, and this path broadcasts through the wallet anyway.
	it("requests send, not sign, for transactions", () => {
		const ns = buildOptionalNamespaces();
		expect(ns.eip155.methods).toContain("eth_sendTransaction");
		expect(ns.eip155.methods).not.toContain("eth_signTransaction");
		expect(ns.eip155.methods).toContain("personal_sign");
		expect(ns.eip155.methods).toContain("eth_signTypedData_v4");
	});

	it("subscribes to chain and account changes", () => {
		expect(buildOptionalNamespaces().eip155.events.sort()).toEqual([
			"accountsChanged",
			"chainChanged",
		]);
	});
});

describe("firstAccountAddress", () => {
	it("extracts the address from a CAIP-10 account", () => {
		expect(
			firstAccountAddress({
				eip155: { accounts: ["eip155:8453:0xAbC0000000000000000000000000000000000001"] },
			})
		).toBe("0xAbC0000000000000000000000000000000000001");
	});

	it("returns null when the wallet approved nothing", () => {
		expect(firstAccountAddress({ eip155: { accounts: [] } })).toBeNull();
		expect(firstAccountAddress({})).toBeNull();
	});
});

describe("sessionHasChain", () => {
	const ns = {
		eip155: { accounts: ["eip155:8453:0x0000000000000000000000000000000000000001"] },
	};

	it("is true for an approved chain", () => {
		expect(sessionHasChain(ns, 8453)).toBe(true);
	});

	it("is false for a chain the wallet did not approve", () => {
		expect(sessionHasChain(ns, 143)).toBe(false);
	});
});
