import { describe, expect, it } from "vitest";
import { CHAIN_NAMES, SUPPORTED_CHAINS, getChainConfig } from "./constants.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

describe("chain listing", () => {
	it("rejects a chain it does not offer", () => {
		expect(() => getChainConfig("unknown")).toThrow(FibxError);
		try {
			getChainConfig("unknown");
		} catch (error) {
			expect((error as FibxError).code).toBe(ErrorCode.UNSUPPORTED_CHAIN);
		}
	});

	it("offers base, hyperevm and monad", () => {
		expect([...CHAIN_NAMES]).toEqual(["base", "hyperevm", "monad"]);
		for (const name of CHAIN_NAMES) {
			expect(getChainConfig(name).name).toBe(name);
		}
	});

	it("has a config row for exactly the offered chains", () => {
		expect(Object.keys(SUPPORTED_CHAINS)).toEqual([...CHAIN_NAMES]);
	});
});
