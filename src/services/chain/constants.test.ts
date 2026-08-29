import { describe, expect, it } from "vitest";
import { CHAIN_NAMES, SUPPORTED_CHAINS, getChainConfig } from "./constants.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

/**
 * Citrea was delisted upstream on 2026-08-10. Its Fibrous router answers 502 on
 * every path and its graph service is gone, so quoting, trading and balances
 * cannot work there. These tests pin the withdrawal: the chain stays in
 * SUPPORTED_CHAINS because the table is keyed structurally, but nothing offers
 * it. Re-adding "citrea" to the listed set is what makes them fail.
 */
describe("chain listing", () => {
	it("does not offer citrea", () => {
		expect(CHAIN_NAMES).not.toContain("citrea");
	});

	it("rejects citrea as a chain argument", () => {
		expect(() => getChainConfig("citrea")).toThrow(FibxError);
		try {
			getChainConfig("citrea");
		} catch (error) {
			expect((error as FibxError).code).toBe(ErrorCode.UNSUPPORTED_CHAIN);
		}
	});

	it("still offers base, hyperevm and monad", () => {
		expect([...CHAIN_NAMES]).toEqual(["base", "hyperevm", "monad"]);
		for (const name of CHAIN_NAMES) {
			expect(getChainConfig(name).name).toBe(name);
		}
	});

	it("keeps the citrea row so existing keyed lookups resolve", () => {
		expect(SUPPORTED_CHAINS.citrea?.id).toBe(4114);
	});
});
