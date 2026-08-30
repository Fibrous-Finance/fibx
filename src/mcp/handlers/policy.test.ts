import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
	loadPolicy: vi.fn(),
	savePolicy: vi.fn(),
	clearPolicy: vi.fn(),
}));

vi.mock("../../services/policy/store.js", () => ({
	loadPolicy: mocks.loadPolicy,
	savePolicy: mocks.savePolicy,
	clearPolicy: mocks.clearPolicy,
	policyPath: () => "/tmp/does-not-exist/policy.json",
}));

const { handleGetPolicy } = await import("./policy.js");

/** The handlers return MCP content blocks; this reads the JSON back out. */
function parse(result: { content: { type: string; text: string }[] }) {
	return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("get_policy", () => {
	it("reports the active rules", async () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "0.05" } });

		const out = parse(await handleGetPolicy());

		expect(out.state).toBe("active");
		expect(out.rules).toEqual({ maxValue: { base: "0.05" } });
	});

	it("reports absence, which permits everything", async () => {
		mocks.loadPolicy.mockReturnValue(null);

		expect(parse(await handleGetPolicy()).state).toBe("absent");
	});

	// The distinction that must never be lost: a file that is present but
	// cannot be trusted refuses every transaction, and saying "absent" here
	// would tell the caller the opposite of the truth.
	it("keeps unreadable distinct from absent", async () => {
		mocks.loadPolicy.mockReturnValue("unreadable");

		const out = parse(await handleGetPolicy());

		expect(out.state).toBe("unreadable");
		expect(out.rules).toBeUndefined();
	});

	// A policy whose groups are all empty is reachable by hand-editing, and
	// bounds nothing — reporting it as active would be misleading.
	it("treats an empty policy as absent", async () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: {} });

		expect(parse(await handleGetPolicy()).state).toBe("absent");
	});
});

const { handleSetPolicyRule, handleClearPolicyRule } = await import("./policy.js");

describe("set_policy_rule", () => {
	it("applies a rule onto the existing policy and saves it", async () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "0.05" } });

		const out = parse(await handleSetPolicyRule({ rule: "base.maxValue", value: "0.01" }));

		expect(mocks.savePolicy).toHaveBeenCalledWith({ maxValue: { base: "0.01" } });
		expect(out.ok).toBe(true);
	});

	it("starts a policy when none exists", async () => {
		mocks.loadPolicy.mockReturnValue(null);

		await handleSetPolicyRule({ rule: "expiry", value: "2026-12-31" });

		expect(mocks.savePolicy).toHaveBeenCalledWith({ expiry: "2026-12-31" });
	});

	// Writing on top of a file we could not parse would silently discard
	// whatever the user had, so refuse and name the file instead.
	it("refuses to write over an unreadable policy", async () => {
		mocks.loadPolicy.mockReturnValue("unreadable");

		await expect(
			handleSetPolicyRule({ rule: "expiry", value: "2026-12-31" })
		).rejects.toThrow();
		expect(mocks.savePolicy).not.toHaveBeenCalled();
	});

	it("rejects an unknown rule rather than storing it", async () => {
		mocks.loadPolicy.mockReturnValue(null);

		await expect(handleSetPolicyRule({ rule: "nonsense", value: "1" })).rejects.toThrow();
		expect(mocks.savePolicy).not.toHaveBeenCalled();
	});
});

describe("clear_policy_rule", () => {
	it("removes one rule and saves the rest", async () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "0.05" }, expiry: "2026-12-31" });

		await handleClearPolicyRule({ rule: "expiry" });

		expect(mocks.savePolicy).toHaveBeenCalledWith({ maxValue: { base: "0.05" } });
	});

	// Asking to remove something that is not set is a normal thing to do and
	// is not a failure — it just did not change anything.
	it("reports no change when the rule was never set", async () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "0.05" } });

		const out = parse(await handleClearPolicyRule({ rule: "expiry" }));

		expect(out.changed).toBe(false);
		expect(mocks.savePolicy).not.toHaveBeenCalled();
	});

	it("removes the whole policy when no rule is named", async () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "0.05" } });

		await handleClearPolicyRule({});

		expect(mocks.clearPolicy).toHaveBeenCalled();
		expect(mocks.savePolicy).not.toHaveBeenCalled();
	});
});
