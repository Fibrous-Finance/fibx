import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import type { IKeyValueStorage } from "@walletconnect/keyvaluestorage";

/**
 * SignClient's default Node storage writes into the working directory. Pairing
 * keys are secret material, so this keeps them beside session.json with the
 * same 0600 mode.
 *
 * The whole store is small — a handful of sessions and keys — so it is read and
 * written whole rather than incrementally.
 */
export class FileKeyValueStorage implements IKeyValueStorage {
	private readonly file: string;

	constructor(file: string) {
		this.file = file;
	}

	private read(): Record<string, unknown> {
		try {
			return JSON.parse(readFileSync(this.file, "utf-8")) as Record<string, unknown>;
		} catch {
			// Missing or corrupt: an empty store lets pairing start over rather
			// than wedging the CLI on a file the user cannot see.
			return {};
		}
	}

	private write(data: Record<string, unknown>): void {
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, JSON.stringify(data), { encoding: "utf-8", mode: 0o600 });
		// mode on writeFileSync only applies when the file is created, so an
		// existing store keeps whatever permissions it had. Re-assert them.
		chmodSync(this.file, 0o600);
	}

	async getKeys(): Promise<string[]> {
		return Object.keys(this.read());
	}

	async getEntries<T = unknown>(): Promise<[string, T][]> {
		return Object.entries(this.read()) as [string, T][];
	}

	async getItem<T = unknown>(key: string): Promise<T | undefined> {
		return this.read()[key] as T | undefined;
	}

	async setItem<T = unknown>(key: string, value: T): Promise<void> {
		const data = this.read();
		data[key] = value;
		this.write(data);
	}

	async removeItem(key: string): Promise<void> {
		const data = this.read();
		delete data[key];
		this.write(data);
	}

	/**
	 * Removes the whole store. Logging out has to leave nothing behind: what is
	 * in here is symmetric keys, session topics and pairing material, and it
	 * would otherwise sit in the config directory indefinitely. `force` makes a
	 * missing file a success, which is the common case.
	 */
	destroy(): void {
		rmSync(this.file, { force: true });
	}
}
