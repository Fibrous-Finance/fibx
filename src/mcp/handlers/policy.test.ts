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
