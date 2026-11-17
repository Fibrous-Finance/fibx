import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { paths } from "../../lib/config.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // NIST SP 800-38D optimal for AES-GCM
const TAG_LEN = 16;
const HEX_KEY = /^[0-9a-f]{64}$/i;

const KEY_FILE = join(paths.config, "encryption-key");

/**
 * The one error for "the imported key is there but cannot be used".
 *
 * It must never be swallowed or replaced by a fresh key: the key file is the
 * only thing that can decrypt session.json's private key, so a silent new key
 * turns a recoverable situation (restore the file, set the secret again) into
 * a lost one. Nothing is deleted on this path.
 */
function undecryptable(reason: string, options?: { cause?: unknown }): FibxError {
	return new FibxError(
		ErrorCode.DECRYPTION_FAILED,
		`The stored private key cannot be decrypted: ${reason} Nothing was deleted. ` +
			`Restore the key file at ${KEY_FILE}, or set FIBX_SESSION_SECRET to the secret ` +
			"the key was imported with — or import the key again with `fibx auth import` " +
			"(if the key file is damaged, move it aside first).",
		{ keyFile: KEY_FILE },
		options
	);
}

function readKeyFile(): Buffer | null {
	let raw: string;
	try {
		raw = readFileSync(KEY_FILE, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw undecryptable(`the key file at ${KEY_FILE} could not be read.`, { cause: error });
	}

	// The same reason session.ts re-asserts 0600 on every save: open() applies a
	// mode only when it creates the file, so a key file left loose by an older
	// version or by hand stays loose unless it is tightened here. Best effort —
	// a file this process cannot chmod can still be read.
	try {
		chmodSync(KEY_FILE, 0o600);
	} catch {
		// noop
	}

	const hex = raw.trim();
	if (!HEX_KEY.test(hex)) {
		throw undecryptable(`the key file at ${KEY_FILE} does not hold a key (64 hex characters).`);
	}
	return Buffer.from(hex, "hex");
}

/**
 * Creates the key file only if it does not exist, without ever replacing one.
 *
 * The key is written to a private temporary file and hard-linked into place:
 * link() fails if the target exists and never exposes a half-written file,
 * which neither a plain write (truncates) nor rename() (replaces) can promise.
 * A filesystem without hard links (exFAT, some SMB mounts) falls back to an
 * exclusive create of the final path — still never a replacement, at the cost
 * of a window in which a crash could leave the file short, which readKeyFile
 * then reports instead of trusting. Losing the race to another process is
 * fine either way: its key is the one to use.
 */
function createKeyFile(): Buffer {
	const key = randomBytes(32);
	const hex = key.toString("hex");
	mkdirSync(dirname(KEY_FILE), { recursive: true });

	const tmp = `${KEY_FILE}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
	writeFileSync(tmp, hex, { encoding: "utf-8", mode: 0o600, flag: "wx" });
	try {
		try {
			linkSync(tmp, KEY_FILE);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") throw error;
			writeFileSync(KEY_FILE, hex, { encoding: "utf-8", mode: 0o600, flag: "wx" });
		}
		return key;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const existing = readKeyFile();
		if (!existing) throw error;
		return existing;
	} finally {
		unlinkSync(tmp);
	}
}

/**
 * The machine-local encryption key, from FIBX_SESSION_SECRET if set, else from
 * the key file in the OS config directory (e.g. ~/.config/fibx-nodejs/ on
 * Linux, ~/Library/Preferences/fibx-nodejs/ on macOS).
 *
 * Only encryption may create the key file. Decrypting with a key that did not
 * exist when the ciphertext was made can only fail, so a missing file on that
 * path is reported rather than filled in.
 */
function getEncryptionKey({ create }: { create: boolean }): Buffer {
	// Env var takes precedence (for CI/Docker)
	const envSecret = process.env.FIBX_SESSION_SECRET;
	if (envSecret) {
		if (HEX_KEY.test(envSecret)) {
			return Buffer.from(envSecret, "hex");
		}
		// If not hex, derive key from the secret string
		return createHash("sha256").update(envSecret).digest();
	}

	const existing = readKeyFile();
	if (existing) return existing;
	if (create) return createKeyFile();

	throw undecryptable(`there is no key file at ${KEY_FILE} and FIBX_SESSION_SECRET is not set.`);
}

/** Encrypt plaintext → hex string (iv + tag + ciphertext) */
export function encryptPrivateKey(privateKey: string): string {
	const key = getEncryptionKey({ create: true });
	const iv = randomBytes(IV_LEN);

	const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
	const encrypted = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();

	return Buffer.concat([iv, tag, encrypted]).toString("hex");
}

/** Decrypt hex string → plaintext */
export function decryptPrivateKey(hex: string): string {
	const key = getEncryptionKey({ create: false });
	const buf = Buffer.from(hex, "hex");

	const iv = buf.subarray(0, IV_LEN);
	const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
	const ciphertext = buf.subarray(IV_LEN + TAG_LEN);

	try {
		const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
		decipher.setAuthTag(tag);
		return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
	} catch (error) {
		// GCM authenticates: a wrong key fails here rather than producing garbage.
		const source = process.env.FIBX_SESSION_SECRET
			? "FIBX_SESSION_SECRET"
			: `the key file at ${KEY_FILE}`;
		throw undecryptable(`${source} is not the key it was encrypted with.`, {
			cause: error,
		});
	}
}
