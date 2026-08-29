import { describe, expect, it, vi, beforeEach } from "vitest";
import { ErrorCode } from "../../lib/errors.js";

const mocks = vi.hoisted(() => ({ loadPolicy: vi.fn() }));
vi.mock("./store.js", () => ({
	loadPolicy: mocks.loadPolicy,
	policyPath: () => "/tmp/policy.json",
}));

const { assertAllowed } = await import("./enforce.js");

const TX = { chain: "base", to: "0x1111111111111111111111111111111111111111", value: 10n ** 18n };

beforeEach(() => vi.clearAllMocks());

describe("assertAllowed", () => {
	it("returns quietly when there is no policy", () => {
		mocks.loadPolicy.mockReturnValue(null);

		expect(() => assertAllowed(TX)).not.toThrow();
	});

	it("returns quietly when the policy permits", () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "10" } });

		expect(() => assertAllowed(TX)).not.toThrow();
	});

	it("throws POLICY_BLOCKED with the rule's message and how to change it", () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "0.05" } });

		try {
			assertAllowed(TX);
			throw new Error("should have thrown");
		} catch (error) {
			expect((error as { code?: unknown }).code).toBe(ErrorCode.POLICY_BLOCKED);
			expect((error as Error).message).toContain("0.05");
			expect((error as Error).message).toContain("fibx policy");
		}
	});

	// An unreadable policy must stop everything, and the message has to name the
	// file or the user cannot find what to fix.
	it("throws POLICY_BLOCKED naming the file when the policy is unreadable", () => {
		mocks.loadPolicy.mockReturnValue("unreadable");

		try {
			assertAllowed(TX);
			throw new Error("should have thrown");
		} catch (error) {
			expect((error as { code?: unknown }).code).toBe(ErrorCode.POLICY_BLOCKED);
			expect((error as Error).message).toContain("/tmp/policy.json");
		}
	});
});
