import { readFileSync, writeFileSync, mkdirSync, unlinkSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { paths } from "../../lib/config.js";
import { policySchema, type Policy } from "./types.js";

export function policyPath(): string {
	return join(paths.config, "policy.json");
}

/**
 * Reads the policy, distinguishing three states rather than two.
 *
 * `null` means no policy: nothing is restricted, which is how a fresh install
 * behaves. `"unreadable"` means a file is there but cannot be trusted —
 * corrupt, or not matching the schema. Those must not collapse into one value:
 * treating an unreadable policy as an absent one would turn a half-edited limit
 * into no limit at all, which is the one direction a security control must
 * never fail in.
 */
export function loadPolicy(): Policy | null | "unreadable" {
	let raw: string;
	try {
		raw = readFileSync(policyPath(), "utf-8");
	} catch (error) {
		// Absent means no policy, which permits. Anything else means a file is
		// there and cannot be read — a permission error, or a directory where a
		// file should be — and that must refuse rather than silently lift every
		// limit the user set.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		return "unreadable";
	}

	try {
		return policySchema.parse(JSON.parse(raw));
	} catch {
		return "unreadable";
	}
}

/** Written 0600: the policy describes what this machine will sign for. */
export function savePolicy(policy: Policy): void {
	const filePath = policyPath();
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(policy, null, 2), {
		encoding: "utf-8",
		mode: 0o600,
	});
	// mode on writeFileSync only applies when the file is created, so an
	// existing file keeps whatever permissions it had. Re-assert them.
	chmodSync(filePath, 0o600);
}

export function clearPolicy(): void {
	try {
		unlinkSync(policyPath());
	} catch {
		// Already gone. Removing a policy that is not there is not a failure.
	}
}
