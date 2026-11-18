import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ErrorCode } from "../../lib/errors.js";
import type * as NodeFs from "node:fs";

// env-paths ignores XDG_CONFIG_HOME on macOS, so an env var would leave this
// suite pointed at the developer's real key file — the one file it must never
// touch. Mock the config module instead, as session.test.ts does.
const { configDir } = await vi.hoisted(async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	return { configDir: mkdtempSync(joinPath(tmpdir(), "fibx-crypto-")) };
});

vi.mock("../../lib/config.js", () => ({ paths: { config: configDir } }));

// linkSync passes through unless a test sets a failure code, to stand in for a
// filesystem without hard links.
const linkFailure = vi.hoisted(() => ({ code: null as string | null }));
vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof NodeFs>();
	return {
		...fs,
		linkSync: (...args: Parameters<typeof fs.linkSync>) => {
			if (linkFailure.code) {
				throw Object.assign(new Error("link not supported"), { code: linkFailure.code });
			}
			return fs.linkSync(...args);
		},
	};
});

const { encryptPrivateKey, decryptPrivateKey } = await import("./crypto.js");

const KEY_FILE = join(configDir, "encryption-key");
const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const previousSecret = process.env.FIBX_SESSION_SECRET;

function writeKeyFile(contents: string): void {
	mkdirSync(configDir, { recursive: true });
	writeFileSync(KEY_FILE, contents, "utf-8");
}

beforeEach(() => {
	// A secret in the developer's shell would bypass the key file entirely.
	delete process.env.FIBX_SESSION_SECRET;
	rmSync(configDir, { recursive: true, force: true });
});

afterEach(() => {
	if (previousSecret === undefined) delete process.env.FIBX_SESSION_SECRET;
	else process.env.FIBX_SESSION_SECRET = previousSecret;
	rmSync(configDir, { recursive: true, force: true });
	linkFailure.code = null;
});

describe("first run", () => {
	it("creates the key file 0600 and round-trips through it", () => {
		const encrypted = encryptPrivateKey(PRIVATE_KEY);

		expect(readFileSync(KEY_FILE, "utf-8")).toMatch(/^[0-9a-f]{64}$/);
		expect(statSync(KEY_FILE).mode & 0o777).toBe(0o600);
		expect(decryptPrivateKey(encrypted)).toBe(PRIVATE_KEY);
	});

	it("leaves no temporary file behind", () => {
		encryptPrivateKey(PRIVATE_KEY);

		expect(readdirSync(configDir)).toEqual(["encryption-key"]);
	});

	it("reuses the key it created instead of making another", () => {
		encryptPrivateKey(PRIVATE_KEY);
		const first = readFileSync(KEY_FILE, "utf-8");

		encryptPrivateKey(PRIVATE_KEY);

		expect(readFileSync(KEY_FILE, "utf-8")).toBe(first);
	});

	// exFAT and some SMB mounts have no hard links; link() fails with a code
	// other than EEXIST and `fibx auth import` could not work at all.
	it("falls back to an exclusive create where hard links are unsupported", () => {
		linkFailure.code = "EPERM";

		const encrypted = encryptPrivateKey(PRIVATE_KEY);

		expect(readFileSync(KEY_FILE, "utf-8")).toMatch(/^[0-9a-f]{64}$/);
		expect(statSync(KEY_FILE).mode & 0o777).toBe(0o600);
		expect(readdirSync(configDir)).toEqual(["encryption-key"]);
		expect(decryptPrivateKey(encrypted)).toBe(PRIVATE_KEY);
	});
});

describe("an existing key file", () => {
	it("is re-tightened to 0600 when it is loose", () => {
		writeKeyFile(KEY_A);
		chmodSync(KEY_FILE, 0o644);

		encryptPrivateKey(PRIVATE_KEY);

		expect(statSync(KEY_FILE).mode & 0o777).toBe(0o600);
	});
});

/**
 * The key file used to be overwritten with a fresh key whenever it did not
 * hold 64 hex characters, which made every imported key undecryptable and
 * destroyed the one file that might have recovered it.
 */
describe("an invalid key file", () => {
	const damaged = `${KEY_A.slice(0, 40)}\n`; // a truncated write

	it("is left byte for byte unchanged when encrypting", () => {
		writeKeyFile(damaged);

		expect(() => encryptPrivateKey(PRIVATE_KEY)).toThrow(
			expect.objectContaining({ code: ErrorCode.DECRYPTION_FAILED })
		);
		expect(readFileSync(KEY_FILE, "utf-8")).toBe(damaged);
	});

	it("is left byte for byte unchanged when decrypting, and the error names it", () => {
		writeKeyFile(KEY_A);
		const encrypted = encryptPrivateKey(PRIVATE_KEY);
		writeKeyFile(damaged);

		let thrown: unknown;
		try {
			decryptPrivateKey(encrypted);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toMatchObject({ code: ErrorCode.DECRYPTION_FAILED });
		const message = (thrown as Error).message;
		expect(message).toContain(KEY_FILE);
		expect(message).toContain("cannot be decrypted");
		expect(message).toContain("FIBX_SESSION_SECRET");
		expect(message).toContain("fibx auth import");
		expect(readFileSync(KEY_FILE, "utf-8")).toBe(damaged);
	});
});

describe("a decryption failure", () => {
	it("is DECRYPTION_FAILED when the key file holds a different valid key", () => {
		writeKeyFile(KEY_A);
		const encrypted = encryptPrivateKey(PRIVATE_KEY);
		writeKeyFile(KEY_B);

		expect(() => decryptPrivateKey(encrypted)).toThrow(
			expect.objectContaining({ code: ErrorCode.DECRYPTION_FAILED })
		);
		expect(readFileSync(KEY_FILE, "utf-8")).toBe(KEY_B);
	});

	// Imported with the secret set, run once without it: the key file never
	// existed, so there is nothing to decrypt with — and making one now would
	// only hide that.
	it("is DECRYPTION_FAILED, and creates no key file, when FIBX_SESSION_SECRET goes missing", () => {
		process.env.FIBX_SESSION_SECRET = "a secret for ci";
		const encrypted = encryptPrivateKey(PRIVATE_KEY);
		delete process.env.FIBX_SESSION_SECRET;

		expect(() => decryptPrivateKey(encrypted)).toThrow(
			expect.objectContaining({ code: ErrorCode.DECRYPTION_FAILED })
		);
		expect(existsSync(KEY_FILE)).toBe(false);
	});

	it("is DECRYPTION_FAILED when FIBX_SESSION_SECRET appears after a key-file import", () => {
		const encrypted = encryptPrivateKey(PRIVATE_KEY);
		process.env.FIBX_SESSION_SECRET = "a secret for ci";

		expect(() => decryptPrivateKey(encrypted)).toThrow(/FIBX_SESSION_SECRET is not the key/);
	});
});
