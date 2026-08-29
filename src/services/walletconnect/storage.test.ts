import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileKeyValueStorage } from "./storage.js";

const dirs: string[] = [];

function newStore(): { store: FileKeyValueStorage; file: string } {
	const dir = mkdtempSync(join(tmpdir(), "fibx-wc-"));
	dirs.push(dir);
	const file = join(dir, "walletconnect.json");
	return { store: new FileKeyValueStorage(file), file };
}

afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("FileKeyValueStorage", () => {
	it("round-trips a value", async () => {
		const { store } = newStore();
		await store.setItem("topic", { a: 1 });
		expect(await store.getItem("topic")).toEqual({ a: 1 });
	});

	it("returns undefined for a missing key", async () => {
		const { store } = newStore();
		expect(await store.getItem("nope")).toBeUndefined();
	});

	it("lists keys and entries", async () => {
		const { store } = newStore();
		await store.setItem("a", 1);
		await store.setItem("b", 2);
		expect((await store.getKeys()).sort()).toEqual(["a", "b"]);
		expect((await store.getEntries()).sort()).toEqual([
			["a", 1],
			["b", 2],
		]);
	});

	it("removes a key", async () => {
		const { store } = newStore();
		await store.setItem("a", 1);
		await store.removeItem("a");
		expect(await store.getItem("a")).toBeUndefined();
	});

	// Pairing keys are secret material — the file must not be world-readable.
	it("creates the file with 0600 permissions", async () => {
		const { store, file } = newStore();
		await store.setItem("a", 1);
		expect(existsSync(file)).toBe(true);
		expect(statSync(file).mode & 0o777).toBe(0o600);
	});

	it("survives a corrupt file instead of throwing", async () => {
		const { store, file } = newStore();
		await store.setItem("a", 1);
		writeFileSync(file, "{ not json", "utf-8");
		expect(await store.getKeys()).toEqual([]);
	});
});
