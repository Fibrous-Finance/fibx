import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { paths } from "../../lib/config.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // NIST SP 800-38D optimal for AES-GCM
const TAG_LEN = 16;

const KEY_FILE = join(paths.config, "encryption-key");

/**
 * Get or create a machine-local encryption key.
 * Stored in the OS config directory (e.g. ~/.config/fibx-nodejs/ on Linux,
 * ~/Library/Preferences/fibx-nodejs/ on macOS).
 * If FIBX_SESSION_SECRET env var is set, it takes precedence.
 */
function getEncryptionKey(): Buffer {
	// Env var takes precedence (for CI/Docker)
	const envSecret = process.env.FIBX_SESSION_SECRET;
	if (envSecret) {
		if (/^[0-9a-f]{64}$/i.test(envSecret)) {
			return Buffer.from(envSecret, "hex");
		}
		// If not hex, derive key from the secret string
		return createHash("sha256").update(envSecret).digest();
	}

	// Auto-generate machine-local key on first use
	if (existsSync(KEY_FILE)) {
		const hex = readFileSync(KEY_FILE, "utf-8").trim();
		if (/^[0-9a-f]{64}$/i.test(hex)) {
			return Buffer.from(hex, "hex");
		}
	}

	const key = randomBytes(32);
	mkdirSync(dirname(KEY_FILE), { recursive: true });
	writeFileSync(KEY_FILE, key.toString("hex"), { encoding: "utf-8", mode: 0o600 });
	return key;
}

/** Encrypt plaintext → hex string (iv + tag + ciphertext) */
export function encryptPrivateKey(privateKey: string): string {
	const key = getEncryptionKey();
	const iv = randomBytes(IV_LEN);

	const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
	const encrypted = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();

	return Buffer.concat([iv, tag, encrypted]).toString("hex");
}

/** Decrypt hex string → plaintext */
export function decryptPrivateKey(hex: string): string {
	const key = getEncryptionKey();
	const buf = Buffer.from(hex, "hex");

	const iv = buf.subarray(0, IV_LEN);
	const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
	const ciphertext = buf.subarray(IV_LEN + TAG_LEN);

	const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
	decipher.setAuthTag(tag);

	return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}
