import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
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

const { loadSession, saveSession, clearSession } = await import("./session.js");

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
