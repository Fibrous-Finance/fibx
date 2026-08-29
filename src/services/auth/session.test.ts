import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { rmSync, writeFileSync, mkdirSync, readFileSync, statSync, chmodSync } from "node:fs";
import { join } from "node:path";

// env-paths ignores XDG_CONFIG_HOME on macOS — it returns
// ~/Library/Preferences/fibx-nodejs regardless — so steering this suite with an
// env var would not isolate it, and clearSession() would delete the developer's
// real session.json. Mock the config module instead.
const { configDir } = await vi.hoisted(async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	return { configDir: mkdtempSync(joinPath(tmpdir(), "fibx-session-")) };
});

// session.ts and crypto.ts import only `paths` from this module.
vi.mock("../../lib/config.js", () => ({ paths: { config: configDir } }));

const { loadSession, saveSession, clearSession, requireSession, AUTH_HINT } =
	await import("./session.js");

function writeRaw(contents: unknown): void {
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "session.json"), JSON.stringify(contents), "utf-8");
}

beforeEach(() => clearSession());
afterEach(() => rmSync(configDir, { recursive: true, force: true }));

describe("session schema", () => {
	it("round-trips a walletconnect session", () => {
		saveSession({
			walletAddress: "0x1111111111111111111111111111111111111111",
			createdAt: new Date().toISOString(),
			type: "walletconnect",
			wcTopic: "abc123",
		});

		const loaded = loadSession();
		expect(loaded?.type).toBe("walletconnect");
		expect(loaded?.wcTopic).toBe("abc123");
	});

	// Widening the enum must not invalidate sessions written by older versions.
	it("still loads a privy session written before walletconnect existed", () => {
		writeRaw({
			userId: "did:privy:abc",
			walletId: "wallet-1",
			walletAddress: "0x2222222222222222222222222222222222222222",
			userJwt: "a.b.c",
			createdAt: "2026-01-01T00:00:00.000Z",
			type: "privy",
		});

		const loaded = loadSession();
		expect(loaded?.type).toBe("privy");
		expect(loaded?.walletId).toBe("wallet-1");
	});

	it("does not write a wcTopic for other session types", () => {
		saveSession({
			walletAddress: "0x3333333333333333333333333333333333333333",
			createdAt: new Date().toISOString(),
			type: "privy",
		});

		const raw = JSON.parse(readFileSync(join(configDir, "session.json"), "utf-8"));
		expect(raw.wcTopic).toBeUndefined();
	});
});

/**
 * The message is read on two surfaces with opposite constraints, and naming
 * only one of them is a correctness bug rather than a wording preference.
 */
describe("the not-authenticated message", () => {
	// `auth setup` refuses without a TTY by design, so an MCP agent told only
	// to run it gets advice guaranteed to fail. It needs a command the MCP
	// `login` tool can actually relay.
	it("names a command that works over stdio, not only `auth setup`", () => {
		expect(AUTH_HINT).toContain("fibx auth login <email>");
		expect(AUTH_HINT).toContain("fibx auth import");
		expect(AUTH_HINT).toContain("fibx auth connect");
	});

	// The whole point of `auth setup`: stop steering every new user to Privy.
	it("offers the chooser first, rather than naming one path as the way in", () => {
		expect(AUTH_HINT).toContain("fibx auth setup");
	});

	it("is what requireSession throws when there is no session", () => {
		clearSession();

		expect(() => requireSession()).toThrow(AUTH_HINT);
	});
});

/**
 * session.json holds the encrypted private key and a live Privy JWT — the most
 * sensitive file FibX writes. It was going to disk world-readable.
 */
describe("session file permissions", () => {
	const session = {
		walletAddress: "0x4444444444444444444444444444444444444444",
		createdAt: "2026-01-01T00:00:00.000Z",
		type: "walletconnect" as const,
		wcTopic: "abc123",
	};

	it("writes the file 0600", () => {
		saveSession(session);

		expect(statSync(join(configDir, "session.json")).mode & 0o777).toBe(0o600);
	});

	// POSIX open() applies `mode` only when it creates the file, so a
	// session.json that is already loose — written by an older version, or
	// chmod'ed by hand — keeps its permissions through every later save unless
	// they are re-asserted. Mirrors the same test on the policy store.
	it("re-tightens loose permissions when saving over an existing file", () => {
		saveSession(session);
		chmodSync(join(configDir, "session.json"), 0o644);

		saveSession(session);

		expect(statSync(join(configDir, "session.json")).mode & 0o777).toBe(0o600);
	});
});
