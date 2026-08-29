import { describe, expect, it, afterEach, vi } from "vitest";
import { rmSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

// env-paths ignores XDG_CONFIG_HOME on macOS and returns a real user
// directory, so the config module is mocked outright — an env var would not
// isolate this and the suite would write into the developer's own config.
const { configDir } = await vi.hoisted(async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	return { configDir: mkdtempSync(joinPath(tmpdir(), "fibx-policy-")) };
});

vi.mock("../../lib/config.js", () => ({ paths: { config: configDir } }));

const { loadPolicy, savePolicy, clearPolicy, policyPath } = await import("./store.js");

afterEach(() => {
	rmSync(configDir, { recursive: true, force: true });
});

function writeRaw(contents: string): void {
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "policy.json"), contents, "utf-8");
}

describe("policy store", () => {
	it("reports no policy when the file does not exist", () => {
		expect(loadPolicy()).toBeNull();
	});

	it("round-trips a policy", () => {
		savePolicy({ allowedChains: ["base"], maxValue: { base: "0.05" } });

		expect(loadPolicy()).toEqual({ allowedChains: ["base"], maxValue: { base: "0.05" } });
	});

	// Limits are secret in the same sense a session is: they describe what this
	// machine will sign for.
	it("writes the file 0600", () => {
		savePolicy({ allowedChains: ["base"] });

		expect(statSync(policyPath()).mode & 0o777).toBe(0o600);
	});

	// The load-bearing case. Treating a corrupt file as absent would turn a
	// half-edited limit into no limit at all.
	it("reports a corrupt file as unreadable rather than absent", () => {
		writeRaw("{ not json");

		expect(loadPolicy()).toBe("unreadable");
	});

	it("reports a file that parses but does not match the schema as unreadable", () => {
		writeRaw(JSON.stringify({ maxValue: "should-be-an-object" }));

		expect(loadPolicy()).toBe("unreadable");
	});

	it("removes the policy", () => {
		savePolicy({ allowedChains: ["base"] });
		clearPolicy();

		expect(loadPolicy()).toBeNull();
	});

	it("does not fail when clearing a policy that is not there", () => {
		expect(() => clearPolicy()).not.toThrow();
	});
});
