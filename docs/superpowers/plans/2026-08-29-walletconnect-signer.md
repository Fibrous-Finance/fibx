# WalletConnect Signer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone pair the `fibx` CLI with the wallet they already own over WalletConnect v2, so signing happens on their phone instead of in a wallet FibX minted for them.

**Architecture:** WalletConnect becomes a third branch in `getWalletClient()`, the single 47-line file where every signer decision already lives. Unlike the Privy path — which builds a viem *account* and broadcasts the signed payload itself — this branch builds a viem client from a bare address plus a custom EIP-1193 transport, so viem emits `eth_sendTransaction` and the wallet signs *and* broadcasts. The Privy and private-key paths are untouched.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), viem 2.x, `@walletconnect/sign-client` 2.24.0, `qrcode` 1.5.4, vitest, zod 4.

**Spec:** `docs/superpowers/specs/2026-08-29-walletconnect-signer-design.md`

## Global Constraints

- **Dependencies go in `devDependencies`.** `tsup` bundles with `noExternal: [/.*/]`, so the published package has zero runtime dependencies. Every existing library — viem, zod, commander — is a devDependency. Adding to `dependencies` would break that guarantee.
- **Code style:** tabs for indentation, double quotes, semicolons. Match the surrounding file.
- **Imports use `.js` extensions** even for TypeScript sources — the project is ESM.
- **Tests are vitest**, colocated as `<name>.test.ts` beside the source. Run a single file with `./node_modules/.bin/vitest run <path>`.
- **Errors are `FibxError`** from `src/lib/errors.ts` with an `ErrorCode`. Existing codes: `NOT_AUTHENTICATED`, `SESSION_EXPIRED`, `TOKEN_NOT_SUPPORTED`, `ROUTE_NOT_FOUND`, `RPC_ERROR`, `INVALID_ADDRESS`, `INVALID_AMOUNT`, `PRIVY_ERROR`, `FIBROUS_ERROR`, `VALIDATION_ERROR`, `UNSUPPORTED_CHAIN`, `WALLET_ERROR`.
- **Supported chains are `base` (8453), `hyperevm` (999), `monad` (143).** Read them from `SUPPORTED_CHAINS` / `CHAIN_NAMES` in `src/services/chain/constants.ts`; never hardcode a second list.
- **Do not flip the default auth path.** WalletConnect ships as a third option. `fibx auth login` and `fibx auth import` keep working unchanged.
- **Do not touch `fibx-server`, `fibx-telegram-bot`, or `fibx-skills`** in this plan.
- **WalletConnect project id:** `1c19af9778708c97acf595733be5f30d`, overridable via `FIBX_WC_PROJECT_ID`.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/services/walletconnect/storage.ts` | `IKeyValueStorage` backed by a `0600` JSON file in `paths.config` |
| `src/services/walletconnect/client.ts` | `SignClient` singleton — init once per process, reuse |
| `src/services/walletconnect/namespaces.ts` | CAIP-2 namespace construction and account/chain extraction |
| `src/services/walletconnect/connect.ts` | Session lifecycle: produce a URI, await approval, return the session, and tear one down on logout |
| `src/services/walletconnect/provider.ts` | EIP-1193 shim over a live session, pinned to one chain |
| `src/services/walletconnect/qr.ts` | QR as a terminal string and as a data URI |
| `src/commands/auth/connect.ts` | `fibx auth connect` |

**Modified:**

| File | Change |
|---|---|
| `src/services/auth/session.ts` | `type` enum gains `"walletconnect"`; add `wcTopic` |
| `src/lib/config.ts` | Project id constant and accessor |
| `src/services/chain/client.ts` | `getWalletClient()` becomes async; third branch; `managesOwnNonce()` |
| `src/services/defi/aave.ts` | `setWalletClient` takes a capability; `sendWithNonce` honours it |
| `src/commands/trade/swap.ts:48`, `src/commands/wallet/send.ts:38`, `src/commands/defi/aave.ts:172`, `src/mcp/handlers/trade.ts:42`, `src/mcp/handlers/wallet.ts:64`, `src/mcp/handlers/defi.ts:20,88` | `await getWalletClient(...)` |
| `src/index.ts` | Register `auth connect` |
| `src/mcp/tools/auth.ts`, `src/mcp/handlers/auth.ts` | `connect_wallet`, `get_connect_status`; `get_auth_status` reports the session type |
| `src/commands/auth/logout.ts` | Disconnect the wallet's side and remove the pairing store |
| `package.json` | Six devDependencies: `@walletconnect/sign-client`, `@walletconnect/types`, `@walletconnect/keyvaluestorage`, `@walletconnect/utils`, `qrcode`, `@types/qrcode`. The three `@walletconnect` companions and `/utils` are transitive dependencies of `sign-client`, but pnpm does not hoist undeclared transitive dependencies — anything imported by name has to be declared or `tsc --noEmit` fails with TS2307 |
| `README.md`, `MCP.md`, `server.json` | Document the third path and `FIBX_WC_PROJECT_ID` |

---

### Task 1: Session schema accepts a WalletConnect session

**Files:**
- Modify: `src/services/auth/session.ts:8-18`
- Test: `src/services/auth/session.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `Session.type` may be `"walletconnect"`; `Session.wcTopic?: string`

- [ ] **Step 1: Write the failing test**

Create `src/services/auth/session.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/auth/session.test.ts`
Expected: FAIL — the first test throws from `sessionSchema.parse` in `saveSession`, because `"walletconnect"` is not a member of the `type` enum.

- [ ] **Step 3: Write minimal implementation**

In `src/services/auth/session.ts`, change the schema (lines 8-18):

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/services/auth/session.test.ts`
Expected: PASS, 3 tests.

Then run the whole suite to confirm nothing regressed:
Run: `./node_modules/.bin/vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/auth/session.ts src/services/auth/session.test.ts
git commit -m "feat: let a session name a WalletConnect pairing

Widening the type enum keeps every session written by an earlier
version parseable, so no migration runs."
```

---

### Task 2: File-backed SignClient storage

**Files:**
- Create: `src/services/walletconnect/storage.ts`
- Test: `src/services/walletconnect/storage.test.ts`
- Modify: `package.json`, `src/lib/config.ts`

**Interfaces:**
- Consumes: `paths` from `src/lib/config.ts`
- Produces: `class FileKeyValueStorage implements IKeyValueStorage`, `getWcProjectId(): string`, `WC_STORAGE_FILE: string`

`IKeyValueStorage` is an abstract class in `@walletconnect/keyvaluestorage` with exactly five members: `getKeys(): Promise<string[]>`, `getEntries<T>(): Promise<[string, T][]>`, `getItem<T>(key): Promise<T | undefined>`, `setItem<T>(key, value): Promise<void>`, `removeItem(key): Promise<void>`.

The default Node storage writes to the working directory. Pairing keys are secret material, so this writes beside `session.json` with the same `0600` mode that file already uses.

- [ ] **Step 1: Install dependencies**

This repo uses **pnpm** — `pnpm-lock.yaml` and `pnpm-workspace.yaml` are at the
root. Do not use npm; it would write a competing `package-lock.json`.

```bash
pnpm add -D @walletconnect/sign-client@2.24.0 @walletconnect/keyvaluestorage@1.1.1 @walletconnect/types@2.24.0 qrcode@1.5.4 @types/qrcode
```

`@walletconnect/keyvaluestorage` and `@walletconnect/types` must be declared
explicitly even though `sign-client` pulls both in transitively: pnpm does not
hoist undeclared transitive dependencies, so importing `IKeyValueStorage` or
`ISignClient` / `SessionTypes` from them without a direct entry is a phantom
dependency and `tsc --noEmit` fails to resolve it. A passing test run is not
evidence to the contrary — esbuild elides `import type` syntactically without
ever resolving the module, so only a typecheck catches this.

Confirm they landed in `devDependencies`, not `dependencies`:

```bash
node -e "const p=require('./package.json'); console.log('deps:', p.dependencies ?? 'none'); console.log('wc:', p.devDependencies['@walletconnect/sign-client'])"
```

Expected: `deps: none`.

- [ ] **Step 2: Write the failing test**

Create `src/services/walletconnect/storage.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/walletconnect/storage.test.ts`
Expected: FAIL — cannot resolve `./storage.js`.

- [ ] **Step 4: Write minimal implementation**

Create `src/services/walletconnect/storage.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
}
```

Add to `src/lib/config.ts`, after `FIBX_API_URL_DEFAULT`:

```typescript
// WalletConnect project id. This ships inside the published bundle and is
// therefore public — that is normal for a WalletConnect dapp. The origin
// allowlist Reown recommends does not apply to a CLI, which has no origin, so
// the exposure is quota consumption; rotate and republish if that becomes a
// problem.
export const WC_PROJECT_ID_DEFAULT = "1c19af9778708c97acf595733be5f30d";

export function getWcProjectId(): string {
	return process.env.FIBX_WC_PROJECT_ID ?? WC_PROJECT_ID_DEFAULT;
}

export const WC_STORAGE_FILE = "walletconnect.json";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/services/walletconnect/storage.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/config.ts src/services/walletconnect/
git commit -m "feat: store WalletConnect pairing keys at 0600 beside the session

The SDK's default Node storage writes into the working directory; this
keeps secret pairing material with the other credentials instead."
```

---

### Task 3: CAIP-2 namespaces

**Files:**
- Create: `src/services/walletconnect/namespaces.ts`
- Test: `src/services/walletconnect/namespaces.test.ts`

**Interfaces:**
- Consumes: `SUPPORTED_CHAINS`, `CHAIN_NAMES` from `src/services/chain/constants.ts`
- Produces:
  - `buildOptionalNamespaces(): { eip155: { chains: string[]; methods: string[]; events: string[] } }`
  - `caip2(chainId: number): string`
  - `firstAccountAddress(namespaces: Record<string, { accounts: string[] }>): string | null`
  - `sessionHasChain(namespaces: Record<string, { accounts: string[] }>, chainId: number): boolean`

`optionalNamespaces` rather than `requiredNamespaces` is load-bearing: a required namespace the wallet does not know fails the whole pairing, and most wallets do not have Monad or HyperEVM configured.

- [ ] **Step 1: Write the failing test**

Create `src/services/walletconnect/namespaces.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
	buildOptionalNamespaces,
	caip2,
	firstAccountAddress,
	sessionHasChain,
} from "./namespaces.js";

describe("caip2", () => {
	it("formats a chain id", () => {
		expect(caip2(8453)).toBe("eip155:8453");
	});
});

describe("buildOptionalNamespaces", () => {
	it("covers every offered chain", () => {
		const ns = buildOptionalNamespaces();
		expect(ns.eip155.chains.sort()).toEqual(
			["eip155:143", "eip155:8453", "eip155:999"].sort()
		);
	});

	// eth_signTransaction is deliberately absent: MetaMask does not implement it
	// over WalletConnect, and this path broadcasts through the wallet anyway.
	it("requests send, not sign, for transactions", () => {
		const ns = buildOptionalNamespaces();
		expect(ns.eip155.methods).toContain("eth_sendTransaction");
		expect(ns.eip155.methods).not.toContain("eth_signTransaction");
		expect(ns.eip155.methods).toContain("personal_sign");
		expect(ns.eip155.methods).toContain("eth_signTypedData_v4");
	});

	it("subscribes to chain and account changes", () => {
		expect(buildOptionalNamespaces().eip155.events.sort()).toEqual([
			"accountsChanged",
			"chainChanged",
		]);
	});
});

describe("firstAccountAddress", () => {
	it("extracts the address from a CAIP-10 account", () => {
		expect(
			firstAccountAddress({
				eip155: { accounts: ["eip155:8453:0xAbC0000000000000000000000000000000000001"] },
			})
		).toBe("0xAbC0000000000000000000000000000000000001");
	});

	it("returns null when the wallet approved nothing", () => {
		expect(firstAccountAddress({ eip155: { accounts: [] } })).toBeNull();
		expect(firstAccountAddress({})).toBeNull();
	});
});

describe("sessionHasChain", () => {
	const ns = {
		eip155: { accounts: ["eip155:8453:0x0000000000000000000000000000000000000001"] },
	};

	it("is true for an approved chain", () => {
		expect(sessionHasChain(ns, 8453)).toBe(true);
	});

	it("is false for a chain the wallet did not approve", () => {
		expect(sessionHasChain(ns, 143)).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/walletconnect/namespaces.test.ts`
Expected: FAIL — cannot resolve `./namespaces.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/walletconnect/namespaces.ts`:

```typescript
import { CHAIN_NAMES, SUPPORTED_CHAINS } from "../chain/constants.js";

/** Methods this client actually calls. */
const METHODS = ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"];

const EVENTS = ["chainChanged", "accountsChanged"];

export function caip2(chainId: number): string {
	return `eip155:${chainId}`;
}

/**
 * Chains are proposed as OPTIONAL. A required namespace the wallet does not
 * recognise fails the entire pairing, and most wallets have neither Monad nor
 * HyperEVM configured — the user would be unable to connect at all rather than
 * connecting for Base and adding the others later.
 */
export function buildOptionalNamespaces(): {
	eip155: { chains: string[]; methods: string[]; events: string[] };
} {
	return {
		eip155: {
			chains: CHAIN_NAMES.map((name) => caip2(SUPPORTED_CHAINS[name]!.id)),
			methods: [...METHODS],
			events: [...EVENTS],
		},
	};
}

/** CAIP-10 accounts look like `eip155:8453:0xabc…`; the address is the last segment. */
export function firstAccountAddress(
	namespaces: Record<string, { accounts: string[] }>
): string | null {
	const account = namespaces.eip155?.accounts?.[0];
	if (!account) return null;
	const address = account.split(":")[2];
	return address ?? null;
}

export function sessionHasChain(
	namespaces: Record<string, { accounts: string[] }>,
	chainId: number
): boolean {
	const prefix = `${caip2(chainId)}:`;
	return (namespaces.eip155?.accounts ?? []).some((a) => a.startsWith(prefix));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/services/walletconnect/namespaces.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/walletconnect/namespaces.ts src/services/walletconnect/namespaces.test.ts
git commit -m "feat: propose WalletConnect chains as optional namespaces

A required namespace the wallet does not know fails the whole pairing,
and most wallets have no Monad or HyperEVM entry."
```

---

### Task 4: SignClient singleton and pairing

**Files:**
- Create: `src/services/walletconnect/client.ts`, `src/services/walletconnect/connect.ts`
- Test: `src/services/walletconnect/connect.test.ts`

**Interfaces:**
- Consumes: `FileKeyValueStorage`, `getWcProjectId`, `WC_STORAGE_FILE`, `buildOptionalNamespaces`, `firstAccountAddress`
- Produces:
  - `getSignClient(): Promise<ISignClient>` — memoised per process
  - `createPairing(): Promise<{ uri: string; approval: () => Promise<PairedSession> }>`
  - `interface PairedSession { topic: string; address: string }`
  - `getActiveSession(topic: string): Promise<SessionTypes.Struct>` — throws `SESSION_EXPIRED` when gone

- [ ] **Step 1: Write the failing test**

Create `src/services/walletconnect/connect.test.ts`. The SignClient is mocked at the module boundary — the test asserts on our translation of its output, never on the relay:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { FibxError, ErrorCode } from "../../lib/errors.js";

const mocks = vi.hoisted(() => ({ getSignClient: vi.fn() }));
vi.mock("./client.js", () => ({ getSignClient: mocks.getSignClient }));

const { createPairing, getActiveSession } = await import("./connect.js");

const APPROVED = {
	topic: "topic-1",
	namespaces: {
		eip155: { accounts: ["eip155:8453:0xAbC0000000000000000000000000000000000001"] },
	},
};

beforeEach(() => vi.clearAllMocks());

describe("createPairing", () => {
	it("returns the uri and resolves to the approved address", async () => {
		mocks.getSignClient.mockResolvedValue({
			connect: vi.fn().mockResolvedValue({
				uri: "wc:abc@2?relay-protocol=irn&symKey=deadbeef",
				approval: vi.fn().mockResolvedValue(APPROVED),
			}),
		});

		const pairing = await createPairing();
		expect(pairing.uri).toMatch(/^wc:/);

		const session = await pairing.approval();
		expect(session.topic).toBe("topic-1");
		expect(session.address).toBe("0xAbC0000000000000000000000000000000000001");
	});

	it("fails clearly when the relay returns no uri", async () => {
		mocks.getSignClient.mockResolvedValue({
			connect: vi.fn().mockResolvedValue({ uri: undefined, approval: vi.fn() }),
		});

		await expect(createPairing()).rejects.toMatchObject({
			code: ErrorCode.WALLET_ERROR,
		});
	});

	// A user closing the wallet is a normal outcome, not a crash.
	it("surfaces a rejected pairing as WALLET_ERROR", async () => {
		mocks.getSignClient.mockResolvedValue({
			connect: vi.fn().mockResolvedValue({
				uri: "wc:abc@2",
				approval: vi.fn().mockRejectedValue(new Error("User rejected.")),
			}),
		});

		const pairing = await createPairing();
		await expect(pairing.approval()).rejects.toBeInstanceOf(FibxError);
	});

	it("fails when the wallet approves no account", async () => {
		mocks.getSignClient.mockResolvedValue({
			connect: vi.fn().mockResolvedValue({
				uri: "wc:abc@2",
				approval: vi.fn().mockResolvedValue({
					topic: "topic-2",
					namespaces: { eip155: { accounts: [] } },
				}),
			}),
		});

		const pairing = await createPairing();
		await expect(pairing.approval()).rejects.toMatchObject({
			code: ErrorCode.WALLET_ERROR,
		});
	});
});

describe("getActiveSession", () => {
	it("returns the stored session", async () => {
		mocks.getSignClient.mockResolvedValue({
			session: { get: vi.fn().mockReturnValue(APPROVED) },
		});

		await expect(getActiveSession("topic-1")).resolves.toEqual(APPROVED);
	});

	it("reports an expired session with a reconnect instruction", async () => {
		mocks.getSignClient.mockResolvedValue({
			session: {
				get: vi.fn(() => {
					throw new Error("No matching key");
				}),
			},
		});

		await expect(getActiveSession("gone")).rejects.toMatchObject({
			code: ErrorCode.SESSION_EXPIRED,
		});
		await expect(getActiveSession("gone")).rejects.toThrow(/fibx auth connect/);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/walletconnect/connect.test.ts`
Expected: FAIL — cannot resolve `./connect.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/walletconnect/client.ts`:

```typescript
import { join } from "node:path";
import SignClient from "@walletconnect/sign-client";
import type { ISignClient } from "@walletconnect/types";
import { paths, getWcProjectId, WC_STORAGE_FILE } from "../../lib/config.js";
import { FileKeyValueStorage } from "./storage.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

let client: Promise<ISignClient> | null = null;

/**
 * One SignClient per process. Initialisation opens a relay connection, so
 * repeating it per command would pay that cost several times in a single run.
 */
export async function getSignClient(): Promise<ISignClient> {
	if (!client) {
		client = SignClient.init({
			projectId: getWcProjectId(),
			storage: new FileKeyValueStorage(join(paths.config, WC_STORAGE_FILE)),
			metadata: {
				name: "FibX",
				description: "DeFi CLI and MCP server powered by Fibrous aggregation",
				url: "https://docs.fibrous.finance/fibx-agent",
				icons: ["https://fibrous.finance/favicon.ico"],
			},
		}).catch((error: unknown) => {
			client = null; // let the next command retry rather than caching a failure
			throw new FibxError(
				ErrorCode.WALLET_ERROR,
				`Could not reach the WalletConnect relay: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		});
	}
	return client;
}
```

Create `src/services/walletconnect/connect.ts`:

```typescript
import type { SessionTypes } from "@walletconnect/types";
import { getSignClient } from "./client.js";
import { buildOptionalNamespaces, firstAccountAddress } from "./namespaces.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

export interface PairedSession {
	topic: string;
	address: string;
}

export async function createPairing(): Promise<{
	uri: string;
	approval: () => Promise<PairedSession>;
}> {
	const signClient = await getSignClient();

	// The proposal itself can fail before a URI exists — the relay may be
	// unreachable. Left unwrapped, that raw SDK error escapes the FibxError
	// contract every other path here honours, and both the CLI formatter and
	// the MCP error handler fall back to UNKNOWN_ERROR.
	let uri: string | undefined;
	let approval: () => Promise<SessionTypes.Struct>;
	try {
		({ uri, approval } = await signClient.connect({
			optionalNamespaces: buildOptionalNamespaces(),
		}));
	} catch (error) {
		throw new FibxError(
			ErrorCode.WALLET_ERROR,
			`Could not open a WalletConnect pairing: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}

	if (!uri) {
		throw new FibxError(
			ErrorCode.WALLET_ERROR,
			"WalletConnect returned no pairing URI. Try again."
		);
	}

	return {
		uri,
		approval: async () => {
			let session: SessionTypes.Struct;
			try {
				session = await approval();
			} catch (error) {
				// Rejection and timeout arrive the same way; the wallet's own
				// message is the most useful thing to show.
				throw new FibxError(
					ErrorCode.WALLET_ERROR,
					`Wallet did not approve the connection: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}

			const address = firstAccountAddress(session.namespaces);
			if (!address) {
				throw new FibxError(
					ErrorCode.WALLET_ERROR,
					"Wallet approved the connection but shared no account."
				);
			}

			return { topic: session.topic, address };
		},
	};
}

export async function getActiveSession(topic: string): Promise<SessionTypes.Struct> {
	const signClient = await getSignClient();
	try {
		return signClient.session.get(topic);
	} catch {
		throw new FibxError(
			ErrorCode.SESSION_EXPIRED,
			"WalletConnect session is no longer active. Run `fibx auth connect` to pair again."
		);
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/services/walletconnect/connect.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/walletconnect/client.ts src/services/walletconnect/connect.ts src/services/walletconnect/connect.test.ts
git commit -m "feat: pair with a wallet over WalletConnect

One SignClient per process; rejection, timeout and an empty account list
each produce a typed error rather than a bare relay failure."
```

---

### Task 5: EIP-1193 provider over the session

**Files:**
- Create: `src/services/walletconnect/provider.ts`
- Test: `src/services/walletconnect/provider.test.ts`

**Interfaces:**
- Consumes: `getSignClient`, `getActiveSession`, `caip2`, `sessionHasChain`, `SUPPORTED_CHAINS`
- Produces: `createWalletConnectProvider(topic: string, chain: ChainConfig): { request(args: { method: string; params?: unknown[] }): Promise<unknown> }`

This is the shim viem's `custom()` transport wraps. It pins every request to one chain, and repairs a missing chain before the first transaction rather than letting the wallet reject it.

- [ ] **Step 1: Write the failing test**

Create `src/services/walletconnect/provider.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ErrorCode } from "../../lib/errors.js";
import { SUPPORTED_CHAINS } from "../chain/constants.js";

const mocks = vi.hoisted(() => ({ getSignClient: vi.fn(), getActiveSession: vi.fn() }));
vi.mock("./client.js", () => ({ getSignClient: mocks.getSignClient }));
vi.mock("./connect.js", () => ({ getActiveSession: mocks.getActiveSession }));

const { createWalletConnectProvider } = await import("./provider.js");

const BASE = SUPPORTED_CHAINS.base!;
const MONAD = SUPPORTED_CHAINS.monad!;

function sessionWith(chainIds: number[]) {
	return {
		topic: "t",
		namespaces: {
			eip155: {
				accounts: chainIds.map(
					(id) => `eip155:${id}:0x0000000000000000000000000000000000000001`
				),
			},
		},
	};
}

beforeEach(() => vi.clearAllMocks());

describe("walletconnect provider", () => {
	it("forwards a transaction as eth_sendTransaction on the target chain", async () => {
		const request = vi.fn().mockResolvedValue("0xhash");
		mocks.getSignClient.mockResolvedValue({ request });
		mocks.getActiveSession.mockResolvedValue(sessionWith([8453]));

		const provider = createWalletConnectProvider("t", BASE);
		const result = await provider.request({
			method: "eth_sendTransaction",
			params: [{ to: "0x1", value: "0x0" }],
		});

		expect(result).toBe("0xhash");
		expect(request).toHaveBeenCalledWith({
			topic: "t",
			chainId: "eip155:8453",
			request: { method: "eth_sendTransaction", params: [{ to: "0x1", value: "0x0" }] },
		});
	});

	// The wallet holds the key; asking it to sign without broadcasting is a
	// method MetaMask does not implement over WalletConnect.
	it("refuses eth_signTransaction instead of sending an unsupported request", async () => {
		mocks.getSignClient.mockResolvedValue({ request: vi.fn() });
		mocks.getActiveSession.mockResolvedValue(sessionWith([8453]));

		const provider = createWalletConnectProvider("t", BASE);
		await expect(
			provider.request({ method: "eth_signTransaction", params: [] })
		).rejects.toMatchObject({ code: ErrorCode.WALLET_ERROR });
	});

	// The chain cannot be added from here — the SDK rejects a request scoped to
	// a chain the session lacks before it reaches the relay. What the user can
	// act on is an instruction, so that is what this asserts.
	it("names the chain and how to fix it when the wallet did not approve it", async () => {
		const request = vi.fn().mockResolvedValue("0xhash");
		mocks.getSignClient.mockResolvedValue({ request });
		mocks.getActiveSession.mockResolvedValue(sessionWith([8453])); // monad absent

		const provider = createWalletConnectProvider("t", MONAD);
		const attempt = provider.request({ method: "eth_sendTransaction", params: [{}] });

		await expect(attempt).rejects.toMatchObject({ code: ErrorCode.UNSUPPORTED_CHAIN });
		await expect(attempt).rejects.toThrow(/monad/i);
		await expect(attempt).rejects.toThrow(/fibx auth connect/);
		expect(request).not.toHaveBeenCalled();
	});

	it("wraps a rejection from the wallet as WALLET_ERROR", async () => {
		const request = vi.fn().mockRejectedValue(new Error("User rejected."));
		mocks.getSignClient.mockResolvedValue({ request });
		mocks.getActiveSession.mockResolvedValue(sessionWith([8453]));

		const provider = createWalletConnectProvider("t", BASE);
		await expect(
			provider.request({ method: "eth_sendTransaction", params: [{}] })
		).rejects.toMatchObject({ code: ErrorCode.WALLET_ERROR });
	});

	it("does not try to add a chain the session already has", async () => {
		const request = vi.fn().mockResolvedValue("0xhash");
		mocks.getSignClient.mockResolvedValue({ request });
		mocks.getActiveSession.mockResolvedValue(sessionWith([8453, 143]));

		const provider = createWalletConnectProvider("t", MONAD);
		await provider.request({ method: "eth_sendTransaction", params: [{}] });

		expect(request.mock.calls.map((c) => c[0].request.method)).toEqual([
			"eth_sendTransaction",
		]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/walletconnect/provider.test.ts`
Expected: FAIL — cannot resolve `./provider.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/walletconnect/provider.ts`:

```typescript
import type { ChainConfig } from "../chain/constants.js";
import { getSignClient } from "./client.js";
import { getActiveSession } from "./connect.js";
import { caip2, sessionHasChain } from "./namespaces.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

/** Requests that only make sense against the wallet's own key. */
const READ_ONLY_REJECT = new Set(["eth_signTransaction"]);

export interface WalletConnectProvider {
	request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/**
 * An EIP-1193 shim viem's `custom()` transport can wrap. Every request is
 * pinned to one chain, because a WalletConnect session can hold several and the
 * wallet needs to be told which one this call belongs to.
 */
export function createWalletConnectProvider(
	topic: string,
	chain: ChainConfig
): WalletConnectProvider {
	const chainId = caip2(chain.id);

	async function send(method: string, params: unknown[]): Promise<unknown> {
		const signClient = await getSignClient();
		return signClient.request({ topic, chainId, request: { method, params } });
	}

	/**
	 * A session carries the chains the wallet approved at pairing time. The SDK
	 * validates chainId and method against those namespaces locally and throws
	 * before anything reaches the relay, so a missing chain cannot be repaired
	 * by sending a request scoped to it — and wallet_addEthereumChain is not a
	 * method this client negotiates, so it would fail the same check. Tell the
	 * user what to do instead of pretending the wallet refused.
	 */
	async function ensureChain(): Promise<void> {
		const session = await getActiveSession(topic);
		if (sessionHasChain(session.namespaces, chain.id)) return;

		throw new FibxError(
			ErrorCode.UNSUPPORTED_CHAIN,
			`Your wallet did not approve ${chain.name} for this session. Add ${chain.name} ` +
				`in your wallet, then run \`fibx auth connect\` again so the new chain is ` +
				`included.`
		);
	}

	return {
		async request({ method, params = [] }) {
			if (READ_ONLY_REJECT.has(method)) {
				throw new FibxError(
					ErrorCode.WALLET_ERROR,
					`${method} is not available over WalletConnect. The wallet signs and ` +
						`broadcasts in one step, so FibX uses eth_sendTransaction instead.`
				);
			}

			if (method === "eth_sendTransaction") {
				await ensureChain();
			}

			return send(method, params);
		},
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/services/walletconnect/provider.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/walletconnect/provider.ts src/services/walletconnect/provider.test.ts
git commit -m "feat: bridge viem to a WalletConnect session

Pins each request to one chain and offers to add a chain the wallet does
not have, so a Monad trade fails with an instruction rather than an
opaque wallet error."
```

---

### Task 6: QR rendering

**Files:**
- Create: `src/services/walletconnect/qr.ts`
- Test: `src/services/walletconnect/qr.test.ts`

**Interfaces:**
- Consumes: `qrcode`
- Produces: `renderQrTerminal(text: string): Promise<string>`, `renderQrDataUri(text: string): Promise<string>`

Two renderings from one library: the terminal string for the CLI, the data URI for MCP hosts. The MCP Apps CSP allows `img-src 'self' data:`, so a data URI displays inside the sandbox with no external request.

- [ ] **Step 1: Write the failing test**

Create `src/services/walletconnect/qr.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { renderQrTerminal, renderQrDataUri } from "./qr.js";

const URI = "wc:abc123@2?relay-protocol=irn&symKey=deadbeef";

describe("qr rendering", () => {
	it("renders a non-empty block for the terminal", async () => {
		const out = await renderQrTerminal(URI);
		expect(out.length).toBeGreaterThan(0);
		expect(out).toMatch(/\n/); // more than one row
	});

	it("renders a png data uri", async () => {
		const out = await renderQrDataUri(URI);
		expect(out.startsWith("data:image/png;base64,")).toBe(true);
	});

	it("rejects an empty payload rather than emitting a blank code", async () => {
		await expect(renderQrTerminal("")).rejects.toThrow();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/walletconnect/qr.test.ts`
Expected: FAIL — cannot resolve `./qr.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/walletconnect/qr.ts`:

```typescript
import QRCode from "qrcode";

/** Block-character QR for a terminal. */
export async function renderQrTerminal(text: string): Promise<string> {
	if (!text) throw new Error("Cannot render a QR code for an empty payload");
	return QRCode.toString(text, { type: "terminal", small: true });
}

/**
 * PNG data URI, for hosts that render HTML rather than text. The MCP Apps CSP
 * permits `img-src 'self' data:`, so this displays inside the sandbox without
 * any external request.
 */
export async function renderQrDataUri(text: string): Promise<string> {
	if (!text) throw new Error("Cannot render a QR code for an empty payload");
	return QRCode.toDataURL(text, { margin: 1 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/services/walletconnect/qr.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/walletconnect/qr.ts src/services/walletconnect/qr.test.ts
git commit -m "feat: render the pairing code for a terminal and for HTML hosts"
```

---

### Task 7: The seam — async `getWalletClient` with a WalletConnect branch

**Files:**
- Modify: `src/services/chain/client.ts` (whole file)
- Modify: `src/commands/trade/swap.ts:48`, `src/commands/wallet/send.ts:38`, `src/commands/defi/aave.ts:172`, `src/mcp/handlers/trade.ts:42`, `src/mcp/handlers/wallet.ts:64`, `src/mcp/handlers/defi.ts:20` and `:88`
- Modify tests that mock it: `src/commands/trade/swap.test.ts:94`, `src/mcp/handlers/trade.test.ts:68`, `src/mcp/handlers/defi.test.ts:52`, `src/commands/defi/aave.test.ts:71`
- Test: `src/services/chain/client.test.ts` (create)

**Interfaces:**
- Consumes: `createWalletConnectProvider`, `Session`
- Produces:
  - `getWalletClient(session: Session, chain: ChainConfig): Promise<WalletClient>` — **now async**
  - `managesOwnNonce(session: Session): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/services/chain/client.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Session } from "../auth/session.js";
import { SUPPORTED_CHAINS } from "./constants.js";

const mocks = vi.hoisted(() => ({ createWalletConnectProvider: vi.fn() }));
vi.mock("../walletconnect/provider.js", () => ({
	createWalletConnectProvider: mocks.createWalletConnectProvider,
}));

const { getWalletClient, managesOwnNonce } = await import("./client.js");

const BASE = SUPPORTED_CHAINS.base!;
const ADDRESS = "0x1111111111111111111111111111111111111111";

const wcSession: Session = {
	walletAddress: ADDRESS,
	createdAt: "2026-08-29T00:00:00.000Z",
	type: "walletconnect",
	wcTopic: "topic-1",
};

beforeEach(() => vi.clearAllMocks());

describe("getWalletClient — walletconnect", () => {
	it("routes transactions through the provider as eth_sendTransaction", async () => {
		// viem prepares a transaction before emitting it — chain id, nonce, gas,
		// fees — so a provider that answers everything with one string makes this
		// fail on hex parsing rather than on the behaviour under test.
		const sent: unknown[] = [];
		const request = vi.fn(
			async ({ method, params }: { method: string; params?: unknown[] }) => {
				switch (method) {
					case "eth_chainId":
						return "0x2105"; // 8453
					case "eth_getTransactionCount":
						return "0x5";
					case "eth_estimateGas":
						return "0x11170";
					case "eth_maxPriorityFeePerGas":
						return "0x59682f00";
					case "eth_gasPrice":
						return "0x59682f0e";
					case "eth_getBlockByNumber":
						return { baseFeePerGas: "0x7", number: "0x1", timestamp: "0x1" };
					case "eth_sendTransaction":
						sent.push(params?.[0]);
						return "0xhash";
					default:
						// Surfacing the name beats a silent null when viem's
						// preparation changes between versions.
						throw new Error(`unexpected method: ${method}`);
				}
			}
		);
		mocks.createWalletConnectProvider.mockReturnValue({ request });

		const client = await getWalletClient(wcSession, BASE);
		const hash = await client.sendTransaction({
			to: "0x2222222222222222222222222222222222222222",
			value: 0n,
			chain: BASE.viemChain,
		});

		expect(hash).toBe("0xhash");
		// A local account would have signed locally and called
		// eth_sendRawTransaction instead; this asserts the wallet was asked to
		// send, not merely to sign.
		expect(sent).toHaveLength(1);
		expect(request.mock.calls.some((c) => c[0].method === "eth_sendRawTransaction")).toBe(
			false
		);
	});

	it("builds the provider for the session topic and target chain", async () => {
		mocks.createWalletConnectProvider.mockReturnValue({ request: vi.fn() });
		await getWalletClient(wcSession, BASE);
		expect(mocks.createWalletConnectProvider).toHaveBeenCalledWith("topic-1", BASE);
	});

	it("refuses a walletconnect session with no topic", async () => {
		await expect(
			getWalletClient({ ...wcSession, wcTopic: undefined }, BASE)
		).rejects.toThrow(/fibx auth connect/);
	});
});

describe("managesOwnNonce", () => {
	it("is true only for walletconnect", () => {
		expect(managesOwnNonce(wcSession)).toBe(true);
		expect(managesOwnNonce({ ...wcSession, type: "privy" })).toBe(false);
		expect(managesOwnNonce({ ...wcSession, type: "private-key" })).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/chain/client.test.ts`
Expected: FAIL — `managesOwnNonce` is not exported, and the walletconnect session falls into the Privy branch and throws about a missing JWT.

- [ ] **Step 3: Write minimal implementation**

Replace `src/services/chain/client.ts` from `getWalletClient` onward:

```typescript
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Session } from "../auth/session.js";
import { getPrivateKey } from "../auth/session.js";
import type { ChainConfig } from "./constants.js";
import { toPrivyViemAccount } from "../privy/account.js";
import { createWalletConnectProvider } from "../walletconnect/provider.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

export function getPublicClient(chain: ChainConfig) {
	return createPublicClient({
		chain: chain.viemChain,
		transport: http(chain.rpcUrl),
	});
}

/**
 * True when the remote wallet assigns the nonce itself. Over WalletConnect the
 * wallet both signs and broadcasts, so forcing a nonce invites a conflict;
 * FibX's NonceManager still owns the nonce on every other path.
 */
export function managesOwnNonce(session: Session): boolean {
	return session.type === "walletconnect";
}

/**
 * Async because initialising the WalletConnect client opens a relay connection.
 * The alternative — a module-level singleton with a synchronous accessor — hides
 * an ordering requirement in global state and fails far from its cause.
 */
export async function getWalletClient(session: Session, chain: ChainConfig) {
	if (session.type === "walletconnect") {
		if (!session.wcTopic) {
			throw new FibxError(
				ErrorCode.WALLET_ERROR,
				"WalletConnect session has no pairing. Run `fibx auth connect`."
			);
		}

		// The account is a bare address, not a local account: that makes viem
		// emit eth_sendTransaction through the transport instead of signing
		// locally and calling eth_sendRawTransaction. MetaMask does not
		// implement eth_signTransaction over WalletConnect.
		return createWalletClient({
			account: session.walletAddress as `0x${string}`,
			chain: chain.viemChain,
			transport: custom(createWalletConnectProvider(session.wcTopic, chain)),
		});
	}

	let account;

	const pk = getPrivateKey(session);
	if (session.type === "private-key" && pk) {
		account = privateKeyToAccount(pk as `0x${string}`);
	} else {
		const token = session.userJwt;
		if (!token) {
			throw new FibxError(
				ErrorCode.SESSION_EXPIRED,
				"Session JWT missing. Run `fibx auth login <email>` to re-authenticate."
			);
		}
		const walletId = session.walletId;
		if (!walletId) {
			throw new FibxError(
				ErrorCode.WALLET_ERROR,
				"Wallet ID missing from session. Run `fibx auth login <email>` to re-authenticate."
			);
		}

		account = toPrivyViemAccount(token, walletId, session.walletAddress);
	}

	return createWalletClient({
		account,
		chain: chain.viemChain,
		transport: http(chain.rpcUrl),
	});
}
```

- [ ] **Step 4: Await at every call site**

Add `await` at each of these, leaving everything else on the line intact:

- `src/commands/trade/swap.ts:48` → `const walletClient = await getWalletClient(session, chain);`
- `src/commands/wallet/send.ts:38` → `const walletClient = await getWalletClient(session, chain);`
- `src/commands/defi/aave.ts:172` → `const walletClient = await getWalletClient(session, chainConfig);`
- `src/mcp/handlers/trade.ts:42` → `const walletClient = await getWalletClient(session, chainConfig);`
- `src/mcp/handlers/wallet.ts:64` → `const walletClient = await getWalletClient(session, chainConfig);`
- `src/mcp/handlers/defi.ts:20` and `:88` → `const walletClient = await getWalletClient(session, chainConfig);`

All seven sites are already inside `async` functions.

- [ ] **Step 5: Update the mocks that now must resolve**

In each of `src/commands/trade/swap.test.ts:94`, `src/mcp/handlers/trade.test.ts:68`, `src/mcp/handlers/defi.test.ts:52`, change `mockReturnValue({…})` to `mockResolvedValue({…})`, keeping the same object.

In `src/commands/defi/aave.test.ts:71`, change `getWalletClient: vi.fn(() => ({…}))` to `getWalletClient: vi.fn(async () => ({…}))`.

- [ ] **Step 6: Run the full suite**

Run: `./node_modules/.bin/vitest run`
Expected: PASS — the four new tests from Step 1 plus every existing test.

Then: `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/eslint src/`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/services/chain/client.ts src/services/chain/client.test.ts src/commands src/mcp
git commit -m "feat: sign through a connected wallet

getWalletClient gains a third branch and becomes async. The WalletConnect
branch builds the client from an address plus a transport so viem emits
eth_sendTransaction — MetaMask does not implement eth_signTransaction
over WalletConnect."
```

---

### Task 8: Let the wallet own the nonce for Aave

**Files:**
- Modify: `src/services/defi/aave.ts:92-97` (`setWalletClient`), `:505-507` (`sendWithNonce`), and the eight `writeContract` calls at `:248, :278, :301, :323, :361, :407, :438, :474`
- Modify: `src/commands/defi/aave.ts:172`, `src/mcp/handlers/defi.ts:20,88` — pass the capability
- Test: `src/services/defi/aave.nonce.test.ts` (create)

**Interfaces:**
- Consumes: `managesOwnNonce` from `src/services/chain/client.ts`
- Produces: `setWalletClient(client: WalletClient, opts?: { managesOwnNonce?: boolean }): void`

`AaveService` receives a `WalletClient`, never the session, so the capability is passed in rather than derived.

- [ ] **Step 1: Write the failing test**

Create `src/services/defi/aave.nonce.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WalletClient } from "viem";

// NonceManager reads a pending nonce from the chain. A unit test that needs the
// network is flaky by construction, and nothing else in this suite touches it.
const mocks = vi.hoisted(() => ({
	withNonce: vi.fn(
		async (
			_address: string,
			_client: unknown,
			send: (nonce?: number) => Promise<unknown>
		) => send(7)
	),
}));
vi.mock("../chain/nonceManager.js", () => ({
	NonceManager: { getInstance: () => ({ withNonce: mocks.withNonce }) },
}));

const { AaveService } = await import("./aave.js");
const { SUPPORTED_CHAINS } = await import("../chain/constants.js");

const ACCOUNT = { address: "0x1111111111111111111111111111111111111111" };

beforeEach(() => vi.clearAllMocks());

function stubWalletClient(): WalletClient {
	return {
		account: ACCOUNT,
		writeContract: vi.fn().mockResolvedValue("0xhash"),
	} as unknown as WalletClient;
}

describe("AaveService nonce ownership", () => {
	it("omits the nonce when the remote wallet assigns it", async () => {
		const client = stubWalletClient();
		const service = new AaveService(SUPPORTED_CHAINS.base!);
		service.setWalletClient(client, { managesOwnNonce: true });

		// sendWithNonce is private; exercise it the way the service does.
		const send = vi.fn().mockResolvedValue("0xhash");
		await (service as unknown as {
			sendWithNonce: (fn: (nonce?: number) => Promise<string>) => Promise<string>;
		}).sendWithNonce(send);

		expect(send).toHaveBeenCalledWith(undefined);
	});

	it("still uses the nonce manager on the other paths", async () => {
		const client = stubWalletClient();
		const service = new AaveService(SUPPORTED_CHAINS.base!);
		service.setWalletClient(client); // default: FibX broadcasts

		const send = vi.fn().mockResolvedValue("0xhash");
		await (service as unknown as {
			sendWithNonce: (fn: (nonce?: number) => Promise<string>) => Promise<string>;
		}).sendWithNonce(send);

		expect(mocks.withNonce).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledWith(7);
	});

	it("does not consult the nonce manager at all when the wallet owns it", async () => {
		const client = stubWalletClient();
		const service = new AaveService(SUPPORTED_CHAINS.base!);
		service.setWalletClient(client, { managesOwnNonce: true });

		await (service as unknown as {
			sendWithNonce: (fn: (nonce?: number) => Promise<string>) => Promise<string>;
		}).sendWithNonce(vi.fn().mockResolvedValue("0xhash"));

		expect(mocks.withNonce).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/defi/aave.nonce.test.ts`
Expected: FAIL — `setWalletClient` takes one argument, so the first test still goes through `NonceManager` and `send` is called with a number.

- [ ] **Step 3: Write minimal implementation**

In `src/services/defi/aave.ts`, add a field beside the others (near line 66):

```typescript
	private walletManagesNonce = false;
```

Replace `setWalletClient` (lines 92-97):

```typescript
	/**
	 * `managesOwnNonce` is set when the signer is a remote wallet that both
	 * signs and broadcasts — WalletConnect. Forcing a nonce on that path
	 * conflicts with the wallet's own sequencing.
	 */
	public setWalletClient(walletClient: WalletClient, opts?: { managesOwnNonce?: boolean }) {
		this.walletClient = walletClient;
		this.walletManagesNonce = opts?.managesOwnNonce ?? false;
		if (walletClient.account) {
			this.account = walletClient.account;
			this.userAddress = walletClient.account.address;
		}
	}
```

Replace `sendWithNonce` (lines 505-507):

```typescript
	/**
	 * Broadcasts under the shared nonce lock. Every writeContract in this
	 * service goes through here so two of them can never claim the same nonce —
	 * unless the wallet assigns nonces itself, in which case the field is left
	 * undefined and viem omits it.
	 */
	private async sendWithNonce<T>(send: (nonce?: number) => Promise<T>): Promise<T> {
		if (this.walletManagesNonce) {
			return send(undefined);
		}
		return NonceManager.getInstance().withNonce(this.account!.address, this.publicClient, send);
	}
```

The eight `writeContract({ ...request, nonce })` calls need no change: viem omits an undefined `nonce`.

Update the constructor so the option survives that path too (line 72-81):

```typescript
	constructor(
		chainConfig: ChainConfig,
		walletClient?: WalletClient,
		opts?: { managesOwnNonce?: boolean }
	) {
		this.chainConfig = chainConfig;
		this.publicClient = createPublicClient({
			chain: chainConfig.viemChain,
			transport: http(chainConfig.rpcUrl),
		}) as PublicClient;

		if (walletClient) {
			this.setWalletClient(walletClient, opts);
		}
	}
```

- [ ] **Step 4: Pass the capability from both call sites**

In `src/commands/defi/aave.ts` around line 172:

```typescript
		const { getWalletClient, managesOwnNonce } = await import("../../services/chain/client.js");
		const walletClient = await getWalletClient(session, chainConfig);
		service.setWalletClient(walletClient, { managesOwnNonce: managesOwnNonce(session) });
```

In `src/mcp/handlers/defi.ts`, at both `:20` and `:88`, after building the client:

```typescript
		const walletClient = await getWalletClient(session, chainConfig);
		service.setWalletClient(walletClient, { managesOwnNonce: managesOwnNonce(session) });
```

Add `managesOwnNonce` to the existing import from `../../services/chain/client.js` in that file.

- [ ] **Step 5: Run the full suite**

Run: `./node_modules/.bin/vitest run`
Expected: PASS, including the three new tests and the existing `aave.test.ts` and `nonceManager.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/services/defi/aave.ts src/services/defi/aave.nonce.test.ts src/commands/defi/aave.ts src/mcp/handlers/defi.ts
git commit -m "fix: let a connected wallet assign its own Aave nonces

The wallet broadcasts on the WalletConnect path, so it sequences its own
transactions. NonceManager keeps ownership everywhere else."
```

---

### Task 9: `fibx auth connect`

**Files:**
- Create: `src/commands/auth/connect.ts`
- Modify: `src/index.ts` (import near line 10, command registration near line 232)
- Modify: `README.md`

**Interfaces:**
- Consumes: `createPairing`, `renderQrTerminal`, `saveSession`
- Produces: `authConnectCommand(opts: OutputOptions): Promise<void>`

- [ ] **Step 1: Write the implementation**

There is no unit test for this step: the command is a thin composition of pieces already covered by Tasks 4, 6 and 1, and its real proof is the manual pairing in Task 11. Keep it thin enough that this stays true — any logic worth testing belongs in the modules below it.

Create `src/commands/auth/connect.ts`:

```typescript
import { createPairing } from "../../services/walletconnect/connect.js";
import { renderQrTerminal } from "../../services/walletconnect/qr.js";
import { saveSession } from "../../services/auth/session.js";
import { createSpinner, outputResult, formatError, type OutputOptions } from "../../lib/format.js";

export async function authConnectCommand(opts: OutputOptions): Promise<void> {
	try {
		const spinner = createSpinner("Opening a WalletConnect pairing...").start();
		const { uri, approval } = await createPairing();
		spinner.stop();

		if (opts.json) {
			// A machine caller wants the URI, not a picture of it.
			console.log(JSON.stringify({ uri }));
		} else {
			console.log(await renderQrTerminal(uri));
			console.log("Scan with your wallet, or paste this URI into it:\n");
			console.log(uri + "\n");
		}

		const waiting = createSpinner("Waiting for approval in your wallet...").start();
		const session = await approval();
		waiting.succeed("Wallet connected");

		saveSession({
			walletAddress: session.address,
			createdAt: new Date().toISOString(),
			type: "walletconnect",
			wcTopic: session.topic,
		});

		outputResult(
			{
				address: session.address,
				type: "walletconnect",
				message: "You're ready to go. Transactions will appear in your wallet for approval.",
			},
			opts
		);
	} catch (error) {
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
```

- [ ] **Step 2: Register the command**

In `src/index.ts`, beside the other auth imports (near line 10):

```typescript
import { authConnectCommand } from "./commands/auth/connect.js";
```

And after the `auth.command("import")` block (near line 237), before `auth.addCommand(logoutCommand)`:

```typescript
auth.command("connect")
	.description("Connect your own wallet over WalletConnect")
	.addHelpText("after", "\nExamples:\n  $ fibx auth connect\n  $ fibx auth connect --json")
	.action(async (_opts, cmd) => {
		const globalOpts = cmd.parent!.parent!.opts();
		await authConnectCommand({ json: globalOpts.json });
	});
```

- [ ] **Step 3: Verify it builds and the command is reachable**

```bash
./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/ && ./node_modules/.bin/tsup
node dist/index.js auth --help
```

Expected: `connect` listed with its description.

- [ ] **Step 4: Document it**

In `README.md`, in the authentication section, add this beside the existing
`auth login` and `auth import` entries:

```markdown
### Connect your own wallet

```bash
npx fibx auth connect
```

Pairs FibX with a wallet you already have — MetaMask, Rabby, Rainbow, Phantom —
over WalletConnect. A QR code appears in the terminal; scan it with your phone.
Every transaction is then approved in your wallet, so the keys never leave it.

Requires the chain to be configured in your wallet. If it is not, FibX asks the
wallet to add it and tells you what to do if the wallet declines.

`auth login` (email OTP) and `auth import` (private key) are unchanged and remain
available.
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/auth/connect.ts src/index.ts README.md
git commit -m "feat: add fibx auth connect

Prints a pairing QR, waits for approval, and stores the topic. The two
existing auth paths are unchanged and still the default."
```

---

### Task 10: MCP tools

**Files:**
- Modify: `src/mcp/tools/auth.ts`, `src/mcp/handlers/auth.ts`
- Modify: `MCP.md`
- Test: `src/mcp/handlers/auth.test.ts` (create)

**Interfaces:**
- Consumes: `createPairing`, `renderQrDataUri`, `saveSession`, `loadSession`
- Produces: handlers `handleConnectWallet()`, `handleGetConnectStatus({ pairingId })`

MCP tools are request/response, so `connect_wallet` must return immediately rather than blocking for however long the user takes to scan. It returns the URI plus a data-URI QR; `get_connect_status` polls. Pending approvals live in a process-local map — the MCP server is one long-lived process, so this needs no persistence.

- [ ] **Step 1: Write the failing test**

Create `src/mcp/handlers/auth.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
	createPairing: vi.fn(),
	renderQrDataUri: vi.fn().mockResolvedValue("data:image/png;base64,AAA"),
	saveSession: vi.fn(),
}));
vi.mock("../../services/walletconnect/connect.js", () => ({ createPairing: mocks.createPairing }));
vi.mock("../../services/walletconnect/qr.js", () => ({ renderQrDataUri: mocks.renderQrDataUri }));
// The whole module is replaced for this file, so every binding auth.ts imports
// from it must be present here even when this test never calls it.
vi.mock("../../services/auth/session.js", () => ({
	saveSession: mocks.saveSession,
	loadSession: vi.fn().mockReturnValue(null),
	requireSession: vi.fn(),
	clearSession: vi.fn(),
	getPrivateKey: vi.fn(),
}));

const { handleConnectWallet, handleGetConnectStatus } = await import("./auth.js");

beforeEach(() => vi.clearAllMocks());

describe("connect_wallet", () => {
	it("returns immediately with a uri, a qr and a pairing id", async () => {
		mocks.createPairing.mockResolvedValue({
			uri: "wc:abc@2",
			approval: () => new Promise(() => {}), // never settles during this test
		});

		const result = await handleConnectWallet();
		expect(result.uri).toBe("wc:abc@2");
		expect(result.qrDataUri.startsWith("data:image/png;base64,")).toBe(true);
		expect(typeof result.pairingId).toBe("string");
	});
});

describe("get_connect_status", () => {
	it("reports pending while the wallet has not answered", async () => {
		mocks.createPairing.mockResolvedValue({
			uri: "wc:abc@2",
			approval: () => new Promise(() => {}),
		});
		const { pairingId } = await handleConnectWallet();

		expect((await handleGetConnectStatus({ pairingId })).status).toBe("pending");
	});

	it("reports connected and saves the session once approved", async () => {
		mocks.createPairing.mockResolvedValue({
			uri: "wc:abc@2",
			approval: async () => ({ topic: "t1", address: "0x1111111111111111111111111111111111111111" }),
		});
		const { pairingId } = await handleConnectWallet();

		await new Promise((r) => setTimeout(r, 0)); // let the approval microtask land

		const status = await handleGetConnectStatus({ pairingId });
		expect(status.status).toBe("connected");
		expect(status.address).toBe("0x1111111111111111111111111111111111111111");
		expect(mocks.saveSession).toHaveBeenCalledWith(
			expect.objectContaining({ type: "walletconnect", wcTopic: "t1" })
		);
	});

	it("reports rejection instead of hanging", async () => {
		mocks.createPairing.mockResolvedValue({
			uri: "wc:abc@2",
			approval: async () => {
				throw new Error("User rejected.");
			},
		});
		const { pairingId } = await handleConnectWallet();

		await new Promise((r) => setTimeout(r, 0));

		const status = await handleGetConnectStatus({ pairingId });
		expect(status.status).toBe("failed");
		expect(status.error).toMatch(/rejected/i);
	});

	it("reports an unknown pairing id", async () => {
		expect((await handleGetConnectStatus({ pairingId: "nope" })).status).toBe("unknown");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/mcp/handlers/auth.test.ts`
Expected: FAIL — `handleConnectWallet` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/mcp/handlers/auth.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { createPairing } from "../../services/walletconnect/connect.js";
import { renderQrDataUri } from "../../services/walletconnect/qr.js";
import { saveSession } from "../../services/auth/session.js";

type PairingState =
	| { status: "pending" }
	| { status: "connected"; address: string }
	| { status: "failed"; error: string };

/**
 * Pending pairings, keyed by an id handed back to the caller. The MCP server is
 * one long-lived process, so this needs no persistence — and a pairing that
 * outlives the process is not resumable anyway.
 */
const pairings = new Map<string, PairingState>();

export async function handleConnectWallet(): Promise<{
	uri: string;
	qrDataUri: string;
	pairingId: string;
}> {
	const { uri, approval } = await createPairing();
	const pairingId = randomUUID();
	pairings.set(pairingId, { status: "pending" });

	// Resolve in the background: an MCP tool call must not block for as long as
	// someone takes to find their phone.
	void approval()
		.then((session) => {
			saveSession({
				walletAddress: session.address,
				createdAt: new Date().toISOString(),
				type: "walletconnect",
				wcTopic: session.topic,
			});
			pairings.set(pairingId, { status: "connected", address: session.address });
		})
		.catch((error: unknown) => {
			pairings.set(pairingId, {
				status: "failed",
				error: error instanceof Error ? error.message : String(error),
			});
		});

	return { uri, qrDataUri: await renderQrDataUri(uri), pairingId };
}

export async function handleGetConnectStatus({
	pairingId,
}: {
	pairingId: string;
}): Promise<{ status: string; address?: string; error?: string }> {
	const state = pairings.get(pairingId);
	if (!state) return { status: "unknown" };
	return { ...state };
}
```

Register both tools in `src/mcp/tools/auth.ts`, inside `registerAuthAndConfigTools`, following the shape of `get_auth_status` and returning the count correctly:

```typescript
	server.registerTool(
		"connect_wallet",
		{
			title: "Connect an External Wallet",
			description:
				"Start a WalletConnect pairing so the user can sign with their own wallet " +
				"(MetaMask, Rabby, Rainbow, Phantom). Returns a URI and a QR image immediately — " +
				"show the QR to the user, then poll get_connect_status until it reports connected.",
			inputSchema: {},
			annotations: { title: "Connect Wallet" },
		},
		withErrorHandling(async () => handleConnectWallet())
	);

	server.registerTool(
		"get_connect_status",
		{
			title: "Check Wallet Connection",
			description:
				"Poll a pairing started by connect_wallet. Returns pending, connected, failed, or unknown.",
			inputSchema: {
				pairingId: z.string().describe("The pairingId returned by connect_wallet"),
			},
			annotations: { title: "Connection Status" },
		},
		withErrorHandling(async (args: { pairingId: string }) => handleGetConnectStatus(args))
	);
```

Update the count this function returns so the server's tool tally stays correct — it currently reports the number of tools registered here; add two.

In `handleGetAuthStatus`, include the session type so a model knows which signing path is live:

```typescript
		authType: session?.type ?? null,
		requiresApprovalPerTransaction: session?.type === "walletconnect",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/mcp/handlers/auth.test.ts`
Expected: PASS, 5 tests.

Then the full suite, typecheck and lint:
Run: `./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/`
Expected: clean.

- [ ] **Step 5: Document it**

In `MCP.md`, add these two rows to the tool table, matching the surrounding
format, and increase the stated tool count from 11 to 13:

```markdown
connect_wallet
Input:  { }
Output: { uri, qrDataUri, pairingId }
Starts a WalletConnect pairing. Returns immediately — show the QR, then poll.

get_connect_status
Input:  { pairingId: string }
Output: { status: "pending" | "connected" | "failed" | "unknown", address?, error? }
Polls a pairing started by connect_wallet.
```

Confirm the count first, since it is generated from the register functions:

```bash
node -e "import('./dist/index.js')" >/dev/null 2>&1; grep -c "registerTool" src/mcp/tools/*.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/auth.ts src/mcp/handlers/auth.ts src/mcp/handlers/auth.test.ts MCP.md
git commit -m "feat: expose wallet pairing over MCP

connect_wallet returns a URI and a data-URI QR immediately and
get_connect_status polls, so the tool call never blocks on a human. The
data URI is what lets an MCP App render the code inside its sandbox."
```

---

### Task 11: Manual end-to-end verification

No unit test can prove this works — the relay, a real wallet and a phone are all involved. This task is the gate on calling the feature done.

**Files:** none

- [ ] **Step 1: Build**

```bash
./node_modules/.bin/tsup
```

- [ ] **Step 2: Pair a real wallet**

```bash
node dist/index.js auth connect
```

Expected: a QR renders. Scan it with MetaMask or Rabby on a phone. Approve.
Expected: `Wallet connected` and the address printed matches the wallet.

- [ ] **Step 3: Confirm the session was written correctly**

```bash
cat "$(node -e "console.log(require('env-paths')('fibx').config)")/session.json"
```

Expected: `"type": "walletconnect"`, a `wcTopic`, and the address. No `privateKey`, no `userJwt`.

- [ ] **Step 4: Read path still works**

```bash
node dist/index.js balance --chain base
```

Expected: balances for the connected address.

- [ ] **Step 5: Sign one transaction on Base**

```bash
node dist/index.js send 0.0001 <your-own-second-address> --chain base
```

Expected: the request appears in the phone wallet; approving returns a hash; the transaction confirms on Base.

- [ ] **Step 6: Exercise the unapproved-chain path**

With Monad **not** approved in the session — the common case, since most wallets do not have it configured:

```bash
node dist/index.js send 0.0001 <your-own-second-address> --chain monad
```

It must be a **signing** command. `quote` requires no auth and never calls `getWalletClient`, so it cannot reach `ensureChain()` and would pass without testing anything.

Expected: a typed `UNSUPPORTED_CHAIN` error naming Monad and telling the user to add it in their wallet and re-run `fibx auth connect` — never a bare RPC failure, and **no prompt in the wallet**. Task 5 removed the add/switch mechanism: `signClient.request()` validates the chain against the approved namespaces locally, so a repair request scoped to the missing chain could never leave the process. Nothing reaches the phone here.

- [ ] **Step 7: Confirm the other two paths are untouched**

```bash
node dist/index.js auth login <your-email>   # Privy path still starts
```

Expected: OTP flow behaves exactly as before.

- [ ] **Step 8: Record the bundle size**

```bash
ls -la dist/index.js
```

The spec accepts growth from 1.8 MB; note the new figure in the commit so the cost is on record.

- [ ] **Step 9: Commit the verification note**

```bash
git commit --allow-empty -m "chore: verify the WalletConnect path end to end

Paired a real wallet, signed a Base transfer from the phone, and
confirmed the Privy and private-key paths still behave as before.
Bundle: <size>."
```

---

## Out of scope — do not do these here

Named so an executor does not helpfully add them:

- Flipping the default auth path to WalletConnect.
- Retiring Privy, or touching its export policy.
- `fibx-server`, `fibx-telegram-bot`, `fibx-skills`.
- ERC-7715 session keys.
- Any MCP App UI.
