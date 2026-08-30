import { readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { z } from "zod";
import { paths } from "../../lib/config.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";
import { encryptPrivateKey, decryptPrivateKey } from "./crypto.js";

const sessionSchema = z.object({
	userId: z.string().optional(),
	walletId: z.string().optional(), // Optional for private-key auth
	walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
	userJwt: z.string().optional(),
	createdAt: z.string(),
	type: z.enum(["privy", "private-key", "walletconnect"]).default("privy"),
	privateKey: z.string().optional(), // Legacy: plaintext (auto-migrated)
	encryptedPrivateKey: z.string().optional(), // New: AES-256-GCM encrypted
	// WalletConnect session topic. The pairing material itself lives in the
	// SignClient store; this is the handle that reconnects to it.
	wcTopic: z.string().optional(),
});

export type Session = z.infer<typeof sessionSchema>;

/**
 * One wording for "you have no wallet yet", used everywhere that discovers it.
 *
 * It has to name both `auth setup` and the three commands it routes to,
 * because it is read on two surfaces with opposite constraints. On a terminal
 * `auth setup` is the right answer — it asks which path you want instead of
 * assuming Privy. Over MCP it is the wrong one: `auth setup` refuses without a
 * TTY by design, so an agent following that advice is guaranteed to fail, and
 * needs a command it can actually relay.
 */
export const AUTH_HINT =
	"Run `fibx auth setup` to choose a signing path, or `fibx auth connect` / `fibx auth login <email>` / `fibx auth import` directly.";

function getSessionPath(): string {
	return join(paths.config, "session.json");
}

/**
 * Written 0600: session.json holds the encrypted private key and a live Privy
 * JWT — anything that can read it can act as the wallet.
 *
 * The chmod is not redundant with the mode. POSIX open() applies `mode` only
 * when it creates the file, so a session.json written by an earlier version
 * (which passed no mode at all, leaving it -rw-r--r--) would keep those
 * permissions through every later save.
 */
function writeSessionFile(session: Session): void {
	const filePath = getSessionPath();
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(session, null, 2), {
		encoding: "utf-8",
		mode: 0o600,
	});
	chmodSync(filePath, 0o600);
}

/**
 * Auto-migrates legacy plaintext privateKey to encrypted form.
 * After migration, the plaintext field is removed from session.json.
 */
function migrateIfNeeded(session: Session): Session {
	if (session.type === "private-key" && session.privateKey && !session.encryptedPrivateKey) {
		try {
			const encrypted = encryptPrivateKey(session.privateKey);
			const migrated: Session = {
				...session,
				encryptedPrivateKey: encrypted,
			};
			// Remove plaintext key
			delete migrated.privateKey;

			// Persist the migration
			writeSessionFile(migrated);

			return migrated;
		} catch {
			// If encryption fails, return the original session
			return session;
		}
	}
	return session;
}

export function loadSession(): Session | null {
	try {
		const raw = readFileSync(getSessionPath(), "utf-8");
		const result = sessionSchema.safeParse(JSON.parse(raw));
		if (!result.success) return null;

		return migrateIfNeeded(result.data);
	} catch {
		return null;
	}
}

export function requireSession(): Session {
	const session = loadSession();
	if (!session) {
		throw new FibxError(ErrorCode.NOT_AUTHENTICATED, `Not authenticated. ${AUTH_HINT}`);
	}

	if (session.userJwt && isSessionExpired(session.userJwt)) {
		clearSession();
		throw new FibxError(ErrorCode.SESSION_EXPIRED, `Session expired. ${AUTH_HINT}`);
	}

	return session;
}

/**
 * Get the decrypted private key from session.
 * Handles both legacy plaintext and new encrypted formats.
 */
export function getPrivateKey(session: Session): string | null {
	if (session.encryptedPrivateKey) {
		try {
			return decryptPrivateKey(session.encryptedPrivateKey);
		} catch {
			return null;
		}
	}
	return session.privateKey ?? null;
}

// Decode JWT payload (no signature verification — client-side expiry check only).
function isSessionExpired(token: string): boolean {
	try {
		const parts = token.split(".");
		if (parts.length !== 3 || !parts[1]) return false;

		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as {
			exp?: number;
		};
		if (!payload.exp) return false;

		// Buffer before actual expiry to avoid mid-request failures
		const SESSION_EXPIRY_BUFFER_SECONDS = 300;
		return Date.now() >= (payload.exp - SESSION_EXPIRY_BUFFER_SECONDS) * 1000;
	} catch {
		return false;
	}
}

export function saveSession(session: Session): void {
	// Clone to avoid mutating the caller's object
	const toSave = { ...session };

	// Encrypt private key before saving
	if (toSave.type === "private-key" && toSave.privateKey && !toSave.encryptedPrivateKey) {
		toSave.encryptedPrivateKey = encryptPrivateKey(toSave.privateKey);
		delete toSave.privateKey;
	}

	sessionSchema.parse(toSave);
	writeSessionFile(toSave);
}

export function clearSession(): void {
	try {
		unlinkSync(getSessionPath());
	} catch {
		// noop
	}
}
