import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// The store is mocked outright rather than isolated to a temp directory: the
// subject here is the command's decision — prompt, obey `--yes`, or refuse —
// and an unmocked `clearPolicy()` would unlink the developer's real
// policy.json. `services/policy/store.test.ts` covers the store itself.
const mocks = vi.hoisted(() => ({
	loadPolicy: vi.fn(),
	clearPolicy: vi.fn(),
	savePolicy: vi.fn(),
	prompt: vi.fn(),
}));

vi.mock("../../services/policy/store.js", () => ({
	loadPolicy: mocks.loadPolicy,
	clearPolicy: mocks.clearPolicy,
	savePolicy: mocks.savePolicy,
	policyPath: () => "/tmp/does-not-exist/policy.json",
}));

vi.mock("inquirer", () => ({ default: { prompt: mocks.prompt } }));

const { removeRule, clearWholePolicy } = await import("./index.js");

describe("removeRule", () => {
	it("removes one chain's cap while a sibling chain's cap survives", () => {
		const before = { maxValue: { base: "0.05", monad: "10" } };

		expect(removeRule(before, "base.maxValue")).toEqual({ maxValue: { monad: "10" } });
	});

	// Leaving `{ maxValue: {} }` behind reads as a policy to a naive emptiness
	// check, even though the evaluator treats an empty group as no
	// restriction at all — the group itself must go when its last chain does.
	it("removes the group entirely when its last entry goes", () => {
		const before = { maxValue: { base: "0.05" } };

		expect(removeRule(before, "base.maxValue")).toEqual({});
	});

	it("removes a scalar rule like expiry", () => {
		const before = { expiry: "2026-12-31" };

		expect(removeRule(before, "expiry")).toEqual({});
	});

	it("removes allowedChains", () => {
		const before = { allowedChains: ["base", "monad"] };

		expect(removeRule(before, "allowedChains")).toEqual({});
	});

	it("removes one chain's destinations while a sibling chain's survive", () => {
		const before = {
			allowedDestinations: {
				base: ["0x1111111111111111111111111111111111111111"],
				monad: ["0x2222222222222222222222222222222222222222"],
			},
		};

		expect(removeRule(before, "base.allowedDestinations")).toEqual({
			allowedDestinations: {
				monad: ["0x2222222222222222222222222222222222222222"],
			},
		});
	});

	// A validly-named rule that simply is not set is not a mistake — a script
	// clearing a rule defensively, to reach a known state, must be able to
	// no-op quietly rather than being told it made an error it did not make.
	// This is a different event from an invalid rule (below), and the two
	// must stay distinguishable: throwing for both would tell a caller doing
	// `fibx policy clear expiry` on a fresh install that it made a mistake.
	it("reports no change removing a rule that was never set, rather than throwing", () => {
		expect(removeRule({}, "base.maxValue")).toBeNull();
	});

	it("reports no change removing one chain's cap when only a sibling's is set", () => {
		const before = { maxValue: { monad: "10" } };

		expect(removeRule(before, "base.maxValue")).toBeNull();
	});

	it("reports no change removing a scalar rule that was never set", () => {
		expect(removeRule({}, "expiry")).toBeNull();
	});

	// An invalid rule name is a different event from "nothing to remove": it
	// is a mistake, the same as a bad `set`, and still throws.
	it("still throws for an invalid rule name rather than silently no-op'ing", () => {
		expect(() => removeRule({}, "base.maxGas")).toThrow(/maxGas/);
	});

	it("still throws for an unknown chain", () => {
		expect(() => removeRule({}, "solana.maxValue")).toThrow(/solana/);
	});
});

/**
 * Bare `fibx policy clear` removes the only bound the imported-key path has,
 * and there is no undo. Three outcomes, and they must stay three: a declined
 * prompt is not an error, and a missing terminal is not consent.
 */
describe("clearWholePolicy", () => {
	const originalIsTty = process.stdout.isTTY;
	const originalStdinIsTty = process.stdin.isTTY;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "0.05" } });
		process.exitCode = undefined;
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		process.stdout.isTTY = originalIsTty;
		process.stdin.isTTY = originalStdinIsTty;
		process.exitCode = undefined;
		vi.restoreAllMocks();
	});

	// Outcome 1a: confirmed at the prompt.
	it("removes the policy when the prompt is confirmed", async () => {
		process.stdout.isTTY = true;
		process.stdin.isTTY = true;
		mocks.prompt.mockResolvedValue({ confirmed: true });

		await clearWholePolicy({});

		expect(mocks.prompt).toHaveBeenCalled();
		expect(mocks.clearPolicy).toHaveBeenCalled();
		expect(process.exitCode).toBeUndefined();
	});

	// Outcome 1b: declined. Distinct from outcome 3 below — the user answered,
	// and the answer was no. Collapsing the two would make a deliberate "no"
	// look like a failure to every script that checks the exit code.
	it("leaves the policy alone and exits 0 when the prompt is declined", async () => {
		process.stdout.isTTY = true;
		process.stdin.isTTY = true;
		mocks.prompt.mockResolvedValue({ confirmed: false });

		await clearWholePolicy({});

		expect(mocks.clearPolicy).not.toHaveBeenCalled();
		expect(process.exitCode).toBeUndefined();
	});

	// The first half of outcome 1: the user must see what they are about to
	// lose, because `clear` and `clear expiry` are one word apart.
	it("shows the rules it is about to remove before asking", async () => {
		process.stdout.isTTY = true;
		process.stdin.isTTY = true;
		mocks.prompt.mockResolvedValue({ confirmed: false });
		mocks.loadPolicy.mockReturnValue({ expiry: "2026-12-31", maxValue: { base: "0.05" } });
		const logged: string[] = [];
		vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
			logged.push(args.map(String).join(" "));
		});

		await clearWholePolicy({});

		expect(logged.join("\n")).toContain("base.maxValue");
		expect(logged.join("\n")).toContain("2026-12-31");
	});

	// Outcome 2: the scripted path. No prompt, on a TTY or off it.
	it("removes the policy immediately with --yes, without prompting", async () => {
		process.stdout.isTTY = true;
		process.stdin.isTTY = true;

		await clearWholePolicy({ yes: true });

		expect(mocks.prompt).not.toHaveBeenCalled();
		expect(mocks.clearPolicy).toHaveBeenCalled();
		expect(process.exitCode).toBeUndefined();
	});

	it("removes the policy with --yes when there is no terminal either", async () => {
		process.stdout.isTTY = false;
		process.stdin.isTTY = false;

		await clearWholePolicy({ yes: true });

		expect(mocks.prompt).not.toHaveBeenCalled();
		expect(mocks.clearPolicy).toHaveBeenCalled();
		expect(process.exitCode).toBeUndefined();
	});

	// Outcome 3: nothing can answer a prompt, so deleting anyway would treat
	// the absence of an answer as a yes. Refuse, and name the flag.
	it("refuses without a terminal and without --yes, naming --yes, exit 1", async () => {
		process.stdout.isTTY = false;
		process.stdin.isTTY = false;
		const errors: string[] = [];
		vi.mocked(console.error).mockImplementation((...args: unknown[]) => {
			errors.push(args.map(String).join(" "));
		});

		await clearWholePolicy({});

		expect(mocks.prompt).not.toHaveBeenCalled();
		expect(mocks.clearPolicy).not.toHaveBeenCalled();
		expect(errors.join("\n")).toContain("--yes");
		expect(process.exitCode).toBe(1);
	});
	// A terminal on stdout is not enough, because the prompt reads stdin.
	// `foo | fibx policy clear` from a terminal renders the question to a TTY
	// and then waits on a pipe that will never answer it — which is the hang
	// outcome 3 exists to prevent.
	it("refuses when stdout is a terminal but stdin is not", async () => {
		process.stdout.isTTY = true;
		process.stdin.isTTY = false;
		const errors: string[] = [];
		vi.mocked(console.error).mockImplementation((...args: unknown[]) => {
			errors.push(args.map(String).join(" "));
		});

		await clearWholePolicy({});

		expect(mocks.prompt).not.toHaveBeenCalled();
		expect(mocks.clearPolicy).not.toHaveBeenCalled();
		expect(errors.join("\n")).toContain("--yes");
		expect(process.exitCode).toBe(1);
	});
});
