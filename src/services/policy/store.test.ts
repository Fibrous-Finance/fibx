import { describe, expect, it, afterEach, vi } from "vitest";
import {
	rmSync,
	writeFileSync,
	mkdirSync,
	statSync,
	chmodSync,
	readFileSync,
	accessSync,
	constants,
} from "node:fs";
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

/** Probes the syscall the permission tests below actually depend on. */
function canRead(file: string): boolean {
	try {
		readFileSync(file);
		return true;
	} catch {
		return false;
	}
}

function canWrite(dir: string): boolean {
	try {
		accessSync(dir, constants.W_OK);
		return true;
	} catch {
		return false;
	}
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

	// The whole point of naming chain keys in the schema is to catch a typo.
	// The obvious way to do that in zod 4 — z.record(z.enum(CHAIN_NAMES), …) —
	// builds an EXHAUSTIVE record, which would demand every chain be present
	// and reject the single-chain policy the docs tell people to write. This is
	// the regression guard for that.
	it("parses a policy naming only one chain", () => {
		writeRaw(JSON.stringify({ maxValue: { base: "0.05" } }));

		expect(loadPolicy()).toEqual({ maxValue: { base: "0.05" } });
	});

	it("round-trips every rule unchanged", () => {
		const policy = {
			expiry: "2026-12-31",
			allowedChains: ["base", "monad"],
			maxValue: { base: "0.05", monad: "10" },
			allowedDestinations: { base: ["0x1111111111111111111111111111111111111111"] },
		};
		savePolicy(policy);

		expect(loadPolicy()).toEqual(policy);
	});

	// A misspelled key used to be dropped in silence, so a file the user
	// believed set a cap set nothing and every transaction was permitted —
	// the same fail-open direction the three-state return exists to prevent.
	it("reports an unknown top-level key as unreadable rather than dropping it", () => {
		writeRaw(JSON.stringify({ maxvalue: { base: "0.05" } }));

		expect(loadPolicy()).toBe("unreadable");
	});

	// `show` printed "Base.maxValue 0.05" as though it were enforced, while the
	// evaluator — which looks up the lowercase chain name — never saw it.
	it("reports an unknown chain key inside maxValue as unreadable", () => {
		writeRaw(JSON.stringify({ maxValue: { Base: "0.05" } }));

		expect(loadPolicy()).toBe("unreadable");
	});

	it("reports an unknown chain key inside allowedDestinations as unreadable", () => {
		writeRaw(
			JSON.stringify({
				allowedDestinations: { solana: ["0x1111111111111111111111111111111111111111"] },
			})
		);

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

	// A file that exists but cannot be read (permission denied) must refuse
	// rather than silently lift every limit.
	//
	// The skip guard is on the read, not on the chmod: chmod always succeeds
	// here — the process owns the file — so guarding it never skipped
	// anything. Reading a 0000 file is the syscall root is allowed to do and
	// nobody else is, so that is what decides whether there is anything to
	// observe.
	it("reports a present-but-unreadable file as unreadable, not absent", (ctx) => {
		writeRaw("{}");
		chmodSync(join(configDir, "policy.json"), 0o000);

		if (canRead(join(configDir, "policy.json"))) {
			ctx.skip("running as root: a 0000 file is still readable, so nothing is denied");
		}

		expect(loadPolicy()).toBe("unreadable");
	});

	/**
	 * A `clear` that cannot remove the file must say so. Swallowing EACCES
	 * alongside ENOENT printed "Signing policy removed" while the policy was
	 * still on disk and still enforced — the user believes they lifted a limit
	 * they did not, which is the mirror image of the fail-open above.
	 */
	it("re-throws when the policy cannot be removed, rather than reporting success", (ctx) => {
		savePolicy({ allowedChains: ["base"] });
		// Unlink needs write permission on the *directory*, not the file.
		chmodSync(configDir, 0o500);

		try {
			if (canWrite(configDir)) {
				ctx.skip("running as root: directory permissions do not deny the unlink");
			}

			expect(() => clearPolicy()).toThrow(/EACCES|EPERM/);
		} finally {
			chmodSync(configDir, 0o700);
		}
	});

	// writeFileSync's mode only applies when creating. An existing file that
	// has been loosened (e.g., by a previous save with a race or external
	// chmod) must have its permissions re-tightened.
	it("re-tightens loose permissions when saving an existing file", () => {
		savePolicy({ allowedChains: ["base"] });
		chmodSync(policyPath(), 0o644);

		// Re-save should re-tighten to 0600.
		savePolicy({ allowedChains: ["base"] });

		expect(statSync(policyPath()).mode & 0o777).toBe(0o600);
	});
});
