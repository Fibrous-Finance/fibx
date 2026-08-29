# Signing Policy and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound every signing path with a local policy evaluated at the last gate before the network, and route new users to the auth path that fits what they need.

**Architecture:** One pure evaluator, `evaluate(transaction, policy, now)`, with no I/O. Two thin adapters call it, because the three paths expose the transaction at different layers: the imported-key and Privy paths hand back a viem account whose `signTransaction` sees readable fields, while WalletConnect hands back a bare address plus a `custom()` transport whose `eth_sendTransaction` params carry them. Both are the last gate before the network — a wrapper around the wallet client would miss `writeContract`, which Aave uses.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), viem 2.x, zod 4, commander 14, inquirer 13, vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-signing-policy-and-onboarding-design.md`

## Global Constraints

- **Dependencies go in `devDependencies`.** `tsup` bundles with `noExternal: [/.*/]`, so the published package has zero runtime dependencies. This plan should add none — `inquirer` is already there and used by `auth import`.
- The repo uses **pnpm**. Installs are `pnpm add -D`; the lockfile is `pnpm-lock.yaml`.
- Code style: **tabs**, double quotes, semicolons. Match the surrounding file.
- Local imports use `.js` extensions — the project is ESM. There is no `require()` in this codebase.
- Errors are `FibxError` from `src/lib/errors.ts`. This plan adds exactly one code: `POLICY_BLOCKED`.
- Tests are vitest, colocated as `<name>.test.ts` beside the source.
- **Run `./node_modules/.bin/tsc --noEmit` before reporting a task done.** A passing suite does not establish that the code typechecks — esbuild elides `import type` without resolving it.
- **No policy means no restriction.** Every rule is optional and an absent one permits. A fresh install must behave exactly as today.
- **Two failure directions are not symmetric.** An absent policy file permits; a file that exists but cannot be parsed, or whose expiry has passed, **refuses everything**. A security control must not fail open.
- Chain names come from `CHAIN_NAMES` / `SUPPORTED_CHAINS` in `src/services/chain/constants.ts`: `base`, `hyperevm`, `monad`. Never a second hardcoded list.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/services/policy/types.ts` | `Policy`, `PolicyTransaction`, `PolicyVerdict`, and the zod schema |
| `src/services/policy/evaluate.ts` | The pure evaluator — no I/O, no imports beyond types |
| `src/services/policy/store.ts` | Load and save `policy.json` at `0600`; corrupt file refuses |
| `src/services/policy/enforce.ts` | `assertAllowed` — loads, evaluates, throws `POLICY_BLOCKED` |
| `src/commands/policy/index.ts` | `fibx policy show / set / clear` |
| `src/commands/auth/setup.ts` | `fibx auth setup` and its pure routing function |

**Modified:**

| File | Change |
|---|---|
| `src/lib/errors.ts` | Add `POLICY_BLOCKED` |
| `src/services/chain/client.ts` | Wrap the account paths with the policy |
| `src/services/walletconnect/provider.ts` | Check the policy on `eth_sendTransaction` |
| `src/services/auth/session.ts` | `requireSession()` points at `fibx auth setup` |
| `src/index.ts` | Register `policy` and `auth setup` |
| `README.md` | Document the three paths, the policy, and what it does not protect against |

---

### Task 1: The policy evaluator

**Files:**
- Create: `src/services/policy/types.ts`, `src/services/policy/evaluate.ts`
- Test: `src/services/policy/evaluate.test.ts`
- Modify: `src/lib/errors.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface PolicyTransaction { chain: string; to?: string; value: bigint }`
  - `interface Policy { allowedChains?: string[]; maxValue?: Record<string, string>; allowedDestinations?: Record<string, string[]>; expiry?: string }`
  - `type PolicyVerdict = { allowed: true } | { allowed: false; rule: string; message: string }`
  - `evaluate(tx: PolicyTransaction, policy: Policy | null, now: Date): PolicyVerdict`
  - `ErrorCode.POLICY_BLOCKED`

- [ ] **Step 1: Write the failing test**

Create `src/services/policy/evaluate.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.js";
import type { Policy, PolicyTransaction } from "./types.js";

const ROUTER = "0x274602a953847d807231d2370072f5f4e4594b44";
const STRANGER = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-08-29T12:00:00.000Z");

function tx(overrides: Partial<PolicyTransaction> = {}): PolicyTransaction {
	return { chain: "base", to: ROUTER, value: 0n, ...overrides };
}

describe("evaluate", () => {
	// A fresh install has no policy, and must behave exactly as it does today.
	it("permits everything when there is no policy", () => {
		expect(evaluate(tx({ value: 10n ** 21n }), null, NOW)).toEqual({ allowed: true });
	});

	it("permits everything when the policy sets no rules", () => {
		expect(evaluate(tx({ value: 10n ** 21n }), {}, NOW)).toEqual({ allowed: true });
	});

	describe("allowedChains", () => {
		const policy: Policy = { allowedChains: ["base", "monad"] };

		it("permits a listed chain", () => {
			expect(evaluate(tx({ chain: "base" }), policy, NOW).allowed).toBe(true);
		});

		it("refuses an unlisted chain and names the rule", () => {
			const verdict = evaluate(tx({ chain: "hyperevm" }), policy, NOW);

			expect(verdict.allowed).toBe(false);
			if (verdict.allowed) throw new Error("unreachable");
			expect(verdict.rule).toBe("allowedChains");
			expect(verdict.message).toContain("hyperevm");
		});
	});

	describe("maxValue", () => {
		const policy: Policy = { maxValue: { base: "0.05" } };

		it("permits a value under the cap", () => {
			expect(evaluate(tx({ value: 10n ** 16n }), policy, NOW).allowed).toBe(true); // 0.01
		});

		// Exactly at the cap is permitted: a cap is a maximum, not a bound below.
		it("permits a value exactly at the cap", () => {
			expect(evaluate(tx({ value: 5n * 10n ** 16n }), policy, NOW).allowed).toBe(true);
		});

		it("refuses a value over the cap and names both figures", () => {
			const verdict = evaluate(tx({ value: 5n * 10n ** 17n }), policy, NOW); // 0.5

			expect(verdict.allowed).toBe(false);
			if (verdict.allowed) throw new Error("unreachable");
			expect(verdict.rule).toBe("maxValue");
			expect(verdict.message).toContain("0.5");
			expect(verdict.message).toContain("0.05");
		});

		// A cap on one chain says nothing about another.
		it("ignores a cap set for a different chain", () => {
			expect(evaluate(tx({ chain: "monad", value: 10n ** 20n }), policy, NOW).allowed).toBe(
				true
			);
		});
	});

	describe("allowedDestinations", () => {
		const policy: Policy = { allowedDestinations: { base: [ROUTER] } };

		it("permits a listed destination", () => {
			expect(evaluate(tx({ to: ROUTER }), policy, NOW).allowed).toBe(true);
		});

		it("matches a destination whatever its casing", () => {
			expect(evaluate(tx({ to: ROUTER.toUpperCase() }), policy, NOW).allowed).toBe(true);
		});

		it("refuses an unlisted destination", () => {
			const verdict = evaluate(tx({ to: STRANGER }), policy, NOW);

			expect(verdict.allowed).toBe(false);
			if (verdict.allowed) throw new Error("unreachable");
			expect(verdict.rule).toBe("allowedDestinations");
		});

		// Contract creation has no `to`. An allowlist that names destinations
		// cannot vouch for one that does not exist.
		it("refuses a transaction with no destination", () => {
			expect(evaluate(tx({ to: undefined }), policy, NOW).allowed).toBe(false);
		});
	});

	describe("expiry", () => {
		// A lapsed policy refuses rather than permits: the opposite would turn a
		// forgotten limit into the silent removal of every limit.
		it("refuses once the expiry has passed", () => {
			const verdict = evaluate(tx(), { expiry: "2026-08-28" }, NOW);

			expect(verdict.allowed).toBe(false);
			if (verdict.allowed) throw new Error("unreachable");
			expect(verdict.rule).toBe("expiry");
		});

		it("permits before the expiry", () => {
			expect(evaluate(tx(), { expiry: "2026-12-31" }, NOW).allowed).toBe(true);
		});

		it("refuses an unparseable expiry rather than ignoring it", () => {
			expect(evaluate(tx(), { expiry: "not-a-date" }, NOW).allowed).toBe(false);
		});
	});

	// Order matters only for which message the user sees first; expiry is
	// checked before anything else because a lapsed policy makes the rest moot.
	it("reports expiry before another violated rule", () => {
		const verdict = evaluate(tx({ chain: "hyperevm" }), {
			expiry: "2026-08-28",
			allowedChains: ["base"],
		}, NOW);

		expect(verdict.allowed).toBe(false);
		if (verdict.allowed) throw new Error("unreachable");
		expect(verdict.rule).toBe("expiry");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/policy/evaluate.test.ts`
Expected: FAIL — cannot resolve `./evaluate.js`.

- [ ] **Step 3: Write the types**

Create `src/services/policy/types.ts`:

```typescript
import { z } from "zod";

/**
 * The transaction as the policy sees it, normalised by whichever adapter
 * caught it. The two adapters observe different shapes — a viem account gets
 * bigints, a WalletConnect provider gets hex strings — so they normalise into
 * this and the evaluator stays free of either.
 */
export interface PolicyTransaction {
	/** Chain name, as in CHAIN_NAMES: "base", "hyperevm", "monad". */
	chain: string;
	/** Absent for contract creation. */
	to?: string;
	/** Native value in wei. */
	value: bigint;
}

export const policySchema = z.object({
	allowedChains: z.array(z.string()).optional(),
	/** Chain name to a decimal amount in native units, e.g. { base: "0.05" }. */
	maxValue: z.record(z.string(), z.string()).optional(),
	/** Chain name to the addresses value and calls may go to. */
	allowedDestinations: z.record(z.string(), z.array(z.string())).optional(),
	/** ISO date. Past it, everything is refused. */
	expiry: z.string().optional(),
});

export type Policy = z.infer<typeof policySchema>;

export type PolicyVerdict =
	| { allowed: true }
	| { allowed: false; rule: string; message: string };
```

- [ ] **Step 4: Write the evaluator**

Create `src/services/policy/evaluate.ts`:

```typescript
import { formatEther, parseEther } from "viem";
import type { Policy, PolicyTransaction, PolicyVerdict } from "./types.js";

const ALLOWED: PolicyVerdict = { allowed: true };

function refuse(rule: string, message: string): PolicyVerdict {
	return { allowed: false, rule, message };
}

/**
 * Decides whether one transaction is within the policy. Pure: no I/O, no clock
 * of its own — `now` is passed so expiry is testable.
 *
 * Every rule is optional and an absent rule permits, so a fresh install with no
 * policy behaves exactly as it did before this existed.
 */
export function evaluate(
	tx: PolicyTransaction,
	policy: Policy | null,
	now: Date
): PolicyVerdict {
	if (!policy) return ALLOWED;

	// First, because a lapsed policy makes every other rule moot — and because
	// refusing is the only safe direction: treating a forgotten expiry as
	// permission would silently remove every limit the user set.
	if (policy.expiry !== undefined) {
		const expiresAt = new Date(policy.expiry);
		if (Number.isNaN(expiresAt.getTime())) {
			return refuse(
				"expiry",
				`Policy expiry "${policy.expiry}" is not a date FibX can read, so nothing is signed. Fix it with \`fibx policy set expiry <YYYY-MM-DD>\`.`
			);
		}
		if (now >= expiresAt) {
			return refuse(
				"expiry",
				`Policy expired on ${policy.expiry}. Extend it with \`fibx policy set expiry <YYYY-MM-DD>\`, or remove it with \`fibx policy clear expiry\`.`
			);
		}
	}

	if (policy.allowedChains && !policy.allowedChains.includes(tx.chain)) {
		return refuse(
			"allowedChains",
			`Policy does not allow ${tx.chain}. Allowed: ${policy.allowedChains.join(", ")}.`
		);
	}

	const cap = policy.maxValue?.[tx.chain];
	if (cap !== undefined) {
		const capWei = parseEther(cap);
		if (tx.value > capWei) {
			return refuse(
				"maxValue",
				`Transaction exceeds the per-transaction cap on ${tx.chain}: ${formatEther(tx.value)} attempted, ${cap} allowed.`
			);
		}
	}

	const destinations = policy.allowedDestinations?.[tx.chain];
	if (destinations) {
		const to = tx.to?.toLowerCase();
		if (!to) {
			return refuse(
				"allowedDestinations",
				`Policy limits where funds may go on ${tx.chain}, and this transaction has no destination (contract creation).`
			);
		}
		if (!destinations.some((d) => d.toLowerCase() === to)) {
			return refuse(
				"allowedDestinations",
				`Policy does not allow sending to ${tx.to} on ${tx.chain}.`
			);
		}
	}

	return ALLOWED;
}
```

- [ ] **Step 5: Add the error code**

In `src/lib/errors.ts`, add to the `ErrorCode` enum after `WALLET_ERROR`:

```typescript
	POLICY_BLOCKED = "POLICY_BLOCKED",
```

None of the existing codes fits: the transaction was well-formed and refused on purpose, which to a user is a categorically different event from a network or wallet failure.

- [ ] **Step 6: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/services/policy/evaluate.test.ts`
Expected: PASS, 15 tests.

Then: `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/eslint src/` — both clean.

- [ ] **Step 7: Commit**

```bash
git add src/services/policy/types.ts src/services/policy/evaluate.ts src/services/policy/evaluate.test.ts src/lib/errors.ts
git commit -m "feat: decide whether a transaction is within a signing policy

A pure evaluator, so every rule is testable without a chain, a key or a
wallet. Absent rules permit, which keeps a fresh install behaving as it
does today; a lapsed or unreadable expiry refuses, because the opposite
would turn a forgotten limit into no limits at all."
```

---

### Task 2: Policy storage

**Files:**
- Create: `src/services/policy/store.ts`
- Test: `src/services/policy/store.test.ts`

**Interfaces:**
- Consumes: `policySchema`, `Policy` from `./types.js`; `paths` from `src/lib/config.ts`
- Produces:
  - `loadPolicy(): Policy | null | "unreadable"`
  - `savePolicy(policy: Policy): void`
  - `clearPolicy(): void`
  - `policyPath(): string`

`loadPolicy` returns three states rather than two, and the third is the point: an absent file permits, an unreadable one must refuse. Collapsing them would fail open.

- [ ] **Step 1: Write the failing test**

Create `src/services/policy/store.test.ts`:

```typescript
import { describe, expect, it, afterEach, vi } from "vitest";
import { rmSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

// env-paths ignores XDG_CONFIG_HOME on macOS and returns a real user
// directory, so the config module is mocked outright — an env var would not
// isolate this and the suite would write into the developer's own config.
const { configDir } = await vi.hoisted(async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	return { configDir: mkdtempSync(joinPath(tmpdir(), "fibx-policy-")) };
});

vi.mock("../../lib/config.js", () => ({ paths: { config: configDir } }));

const { loadPolicy, savePolicy, clearPolicy, policyPath } = await import("./store.js");

afterEach(() => {
	rmSync(configDir, { recursive: true, force: true });
});

function writeRaw(contents: string): void {
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "policy.json"), contents, "utf-8");
}

describe("policy store", () => {
	it("reports no policy when the file does not exist", () => {
		expect(loadPolicy()).toBeNull();
	});

	it("round-trips a policy", () => {
		savePolicy({ allowedChains: ["base"], maxValue: { base: "0.05" } });

		expect(loadPolicy()).toEqual({ allowedChains: ["base"], maxValue: { base: "0.05" } });
	});

	// Limits are secret in the same sense a session is: they describe what this
	// machine will sign for.
	it("writes the file 0600", () => {
		savePolicy({ allowedChains: ["base"] });

		expect(statSync(policyPath()).mode & 0o777).toBe(0o600);
	});

	// The load-bearing case. Treating a corrupt file as absent would turn a
	// half-edited limit into no limit at all.
	it("reports a corrupt file as unreadable rather than absent", () => {
		writeRaw("{ not json");

		expect(loadPolicy()).toBe("unreadable");
	});

	it("reports a file that parses but does not match the schema as unreadable", () => {
		writeRaw(JSON.stringify({ maxValue: "should-be-an-object" }));

		expect(loadPolicy()).toBe("unreadable");
	});

	it("removes the policy", () => {
		savePolicy({ allowedChains: ["base"] });
		clearPolicy();

		expect(loadPolicy()).toBeNull();
	});

	it("does not fail when clearing a policy that is not there", () => {
		expect(() => clearPolicy()).not.toThrow();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/policy/store.test.ts`
Expected: FAIL — cannot resolve `./store.js`.

- [ ] **Step 3: Write the store**

Create `src/services/policy/store.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
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
	} catch {
		return null;
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
}

export function clearPolicy(): void {
	try {
		unlinkSync(policyPath());
	} catch {
		// Already gone. Removing a policy that is not there is not a failure.
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/services/policy/store.test.ts`
Expected: PASS, 7 tests.

Then `./node_modules/.bin/tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/policy/store.ts src/services/policy/store.test.ts
git commit -m "feat: store the signing policy at 0600 beside the session

loadPolicy returns three states, not two. An absent file permits; a file
that exists but cannot be parsed refuses. Collapsing them would let a
half-edited policy silently become no policy."
```

---

### Task 3: The enforcement gate

**Files:**
- Create: `src/services/policy/enforce.ts`
- Test: `src/services/policy/enforce.test.ts`

**Interfaces:**
- Consumes: `evaluate` from `./evaluate.js`; `loadPolicy` from `./store.js`; `FibxError`, `ErrorCode`
- Produces: `assertAllowed(tx: PolicyTransaction): void` — throws `FibxError(POLICY_BLOCKED)` or returns

This is the single function both adapters call, so the message a user sees is written once.

- [ ] **Step 1: Write the failing test**

Create `src/services/policy/enforce.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ErrorCode } from "../../lib/errors.js";

const mocks = vi.hoisted(() => ({ loadPolicy: vi.fn() }));
vi.mock("./store.js", () => ({ loadPolicy: mocks.loadPolicy, policyPath: () => "/tmp/policy.json" }));

const { assertAllowed } = await import("./enforce.js");

const TX = { chain: "base", to: "0x1111111111111111111111111111111111111111", value: 10n ** 18n };

beforeEach(() => vi.clearAllMocks());

describe("assertAllowed", () => {
	it("returns quietly when there is no policy", () => {
		mocks.loadPolicy.mockReturnValue(null);

		expect(() => assertAllowed(TX)).not.toThrow();
	});

	it("returns quietly when the policy permits", () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "10" } });

		expect(() => assertAllowed(TX)).not.toThrow();
	});

	it("throws POLICY_BLOCKED with the rule's message and how to change it", () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "0.05" } });

		try {
			assertAllowed(TX);
			throw new Error("should have thrown");
		} catch (error) {
			expect((error as { code?: unknown }).code).toBe(ErrorCode.POLICY_BLOCKED);
			expect((error as Error).message).toContain("0.05");
			expect((error as Error).message).toContain("fibx policy");
		}
	});

	// An unreadable policy must stop everything, and the message has to name the
	// file or the user cannot find what to fix.
	it("throws POLICY_BLOCKED naming the file when the policy is unreadable", () => {
		mocks.loadPolicy.mockReturnValue("unreadable");

		try {
			assertAllowed(TX);
			throw new Error("should have thrown");
		} catch (error) {
			expect((error as { code?: unknown }).code).toBe(ErrorCode.POLICY_BLOCKED);
			expect((error as Error).message).toContain("/tmp/policy.json");
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/policy/enforce.test.ts`
Expected: FAIL — cannot resolve `./enforce.js`.

- [ ] **Step 3: Write the gate**

Create `src/services/policy/enforce.ts`:

```typescript
import { ErrorCode, FibxError } from "../../lib/errors.js";
import { evaluate } from "./evaluate.js";
import { loadPolicy, policyPath } from "./store.js";
import type { PolicyTransaction } from "./types.js";

/**
 * The single gate both adapters call, so the message a user sees on a refusal
 * is written once rather than twice.
 *
 * Throws rather than returning a verdict: the callers are a viem account's
 * signTransaction and an EIP-1193 provider's request, neither of which has
 * anywhere to put a "no" except an exception.
 */
export function assertAllowed(tx: PolicyTransaction): void {
	const policy = loadPolicy();

	if (policy === "unreadable") {
		throw new FibxError(
			ErrorCode.POLICY_BLOCKED,
			`Signing policy at ${policyPath()} cannot be read, so nothing will be signed. ` +
				`Fix the file, or remove it with \`fibx policy clear\`.`
		);
	}

	const verdict = evaluate(tx, policy, new Date());
	if (verdict.allowed) return;

	throw new FibxError(
		ErrorCode.POLICY_BLOCKED,
		`${verdict.message} See all rules with \`fibx policy show\`.`
	);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run src/services/policy/enforce.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/policy/enforce.ts src/services/policy/enforce.test.ts
git commit -m "feat: add the gate both signing adapters call

Throws rather than returning a verdict, because its callers — a viem
account's signTransaction and an EIP-1193 provider's request — have
nowhere to put a refusal except an exception. One function, so the
message a user sees is written once."
```

---

### Task 4: Enforce on the account paths

**Files:**
- Modify: `src/services/chain/client.ts`
- Test: `src/services/chain/client.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: `assertAllowed` from `src/services/policy/enforce.js`
- Produces: `getWalletClient` unchanged in signature; the account it returns refuses out-of-policy transactions

The imported-key and Privy paths both end at a viem account. Wrapping its `signTransaction` puts the gate at the last point where the fields are readable and before anything reaches the network.

- [ ] **Step 1: Write the failing test**

Append to `src/services/chain/client.test.ts`:

```typescript
describe("policy enforcement on the account paths", () => {
	const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

	// The assertion that matters is not that the evaluator said no — it is that
	// nothing was signed. A correct rule behind a gate nothing calls is worth
	// nothing.
	it("refuses to sign a transaction the policy blocks", async () => {
		mocks.assertAllowed.mockImplementation(() => {
			throw new FibxError(ErrorCode.POLICY_BLOCKED, "nope");
		});

		const client = await getWalletClient(
			{
				walletAddress: privateKeyToAccount(PRIVATE_KEY).address,
				createdAt: "2026-08-29T00:00:00.000Z",
				type: "private-key",
				privateKey: PRIVATE_KEY,
			},
			BASE
		);

		await expect(
			client.account!.signTransaction({ chainId: 8453, to: "0x2222222222222222222222222222222222222222", value: 0n })
		).rejects.toMatchObject({ code: ErrorCode.POLICY_BLOCKED });
	});

	it("signs normally when the policy permits", async () => {
		mocks.assertAllowed.mockImplementation(() => {});

		const client = await getWalletClient(
			{
				walletAddress: privateKeyToAccount(PRIVATE_KEY).address,
				createdAt: "2026-08-29T00:00:00.000Z",
				type: "private-key",
				privateKey: PRIVATE_KEY,
			},
			BASE
		);

		const signed = await client.account!.signTransaction({
			chainId: 8453,
			to: "0x2222222222222222222222222222222222222222",
			value: 0n,
			gas: 21000n,
			maxFeePerGas: 1000000000n,
			maxPriorityFeePerGas: 1n,
			nonce: 0,
			type: "eip1559",
		});

		expect(signed.startsWith("0x")).toBe(true);
	});

	it("hands the policy the chain name and the value, not raw viem fields", async () => {
		mocks.assertAllowed.mockImplementation(() => {});

		const client = await getWalletClient(
			{
				walletAddress: privateKeyToAccount(PRIVATE_KEY).address,
				createdAt: "2026-08-29T00:00:00.000Z",
				type: "private-key",
				privateKey: PRIVATE_KEY,
			},
			BASE
		);

		await client.account!.signTransaction({
			chainId: 8453,
			to: "0x2222222222222222222222222222222222222222",
			value: 7n,
			gas: 21000n,
			maxFeePerGas: 1000000000n,
			maxPriorityFeePerGas: 1n,
			nonce: 0,
			type: "eip1559",
		});

		expect(mocks.assertAllowed).toHaveBeenCalledWith({
			chain: "base",
			to: "0x2222222222222222222222222222222222222222",
			value: 7n,
		});
	});
});
```

Add to that file's existing hoisted mocks block and imports:

```typescript
// added to the existing `mocks` object
	assertAllowed: vi.fn(),
```

```typescript
vi.mock("../policy/enforce.js", () => ({ assertAllowed: mocks.assertAllowed }));
```

```typescript
import { privateKeyToAccount } from "viem/accounts";
import { ErrorCode, FibxError } from "../../lib/errors.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/chain/client.test.ts`
Expected: FAIL — the blocked transaction signs anyway, because nothing consults the policy yet.

- [ ] **Step 3: Wrap the account**

In `src/services/chain/client.ts`, add the import:

```typescript
import { assertAllowed } from "../policy/enforce.js";
```

Add this helper above `getWalletClient`:

```typescript
/**
 * Puts the policy gate on an account's signTransaction.
 *
 * This is the last point where the transaction is readable and the last before
 * anything reaches the network. Wrapping the wallet client instead would miss
 * writeContract — Aave's eight writes reach the transport through viem's own
 * action, not through a method we could have overridden.
 */
function withPolicy<T extends Account>(account: T, chain: ChainConfig): T {
	return {
		...account,
		async signTransaction(transaction: Parameters<T["signTransaction"]>[0], args?: unknown) {
			assertAllowed({
				chain: chain.name,
				to: transaction.to ?? undefined,
				value: transaction.value ?? 0n,
			});
			return (account.signTransaction as (t: unknown, a?: unknown) => Promise<`0x${string}`>)(
				transaction,
				args
			);
		},
	} as T;
}
```

Then, in `getWalletClient`, change the final return so the account is wrapped:

```typescript
	return createWalletClient({
		account: withPolicy(account, chain),
		chain: chain.viemChain,
		transport: http(chain.rpcUrl),
	});
```

Add `Account` to the type imports from `viem`.

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/vitest run`
Expected: PASS — the three new tests and everything already there. The existing WalletConnect tests must be untouched; this task does not change that path.

Then `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/eslint src/`.

- [ ] **Step 5: Commit**

```bash
git add src/services/chain/client.ts src/services/chain/client.test.ts
git commit -m "feat: apply the signing policy to the local-key and Privy paths

Wraps the account's signTransaction, which is the last point the fields
are readable and the last before the network. Wrapping the wallet client
would have missed writeContract, which Aave uses and which reaches the
transport through viem's own action."
```

---

### Task 5: Enforce on the WalletConnect path

**Files:**
- Modify: `src/services/walletconnect/provider.ts`
- Test: `src/services/walletconnect/provider.test.ts` (extend)

**Interfaces:**
- Consumes: `assertAllowed` from `src/services/policy/enforce.js`
- Produces: the provider refuses out-of-policy `eth_sendTransaction` before it reaches the relay

The WalletConnect path has no local account, so the fields arrive as hex strings in the `eth_sendTransaction` params. `request()` already funnels every call, and the `eth_sendTransaction` branch already exists for the chain check.

- [ ] **Step 1: Write the failing test**

Append to `src/services/walletconnect/provider.test.ts`:

```typescript
describe("policy enforcement", () => {
	// Not just that the policy said no — that the wallet was never asked. A
	// refusal that still pushes a request to the user's phone is not a gate.
	it("refuses a blocked transaction without contacting the wallet", async () => {
		mocks.assertAllowed.mockImplementation(() => {
			throw new FibxError(ErrorCode.POLICY_BLOCKED, "over the cap");
		});
		const request = vi.fn();
		mocks.getSignClient.mockResolvedValue({ request });
		mocks.getActiveSession.mockResolvedValue(sessionWith([8453]));

		const provider = createWalletConnectProvider("t", BASE);

		await expect(
			provider.request({
				method: "eth_sendTransaction",
				params: [{ to: "0x2222222222222222222222222222222222222222", value: "0x7" }],
			})
		).rejects.toMatchObject({ code: ErrorCode.POLICY_BLOCKED });
		expect(request).not.toHaveBeenCalled();
	});

	it("normalises the hex value the wallet path carries", async () => {
		mocks.assertAllowed.mockImplementation(() => {});
		const request = vi.fn().mockResolvedValue("0xhash");
		mocks.getSignClient.mockResolvedValue({ request });
		mocks.getActiveSession.mockResolvedValue(sessionWith([8453]));

		const provider = createWalletConnectProvider("t", BASE);
		await provider.request({
			method: "eth_sendTransaction",
			params: [{ to: "0x2222222222222222222222222222222222222222", value: "0x7" }],
		});

		expect(mocks.assertAllowed).toHaveBeenCalledWith({
			chain: "base",
			to: "0x2222222222222222222222222222222222222222",
			value: 7n,
		});
	});

	// A transaction with no value field is a call, not a transfer.
	it("treats a missing value as zero", async () => {
		mocks.assertAllowed.mockImplementation(() => {});
		const request = vi.fn().mockResolvedValue("0xhash");
		mocks.getSignClient.mockResolvedValue({ request });
		mocks.getActiveSession.mockResolvedValue(sessionWith([8453]));

		const provider = createWalletConnectProvider("t", BASE);
		await provider.request({
			method: "eth_sendTransaction",
			params: [{ to: "0x2222222222222222222222222222222222222222" }],
		});

		expect(mocks.assertAllowed).toHaveBeenCalledWith(
			expect.objectContaining({ value: 0n })
		);
	});

	it("does not consult the policy for a signature request", async () => {
		mocks.assertAllowed.mockImplementation(() => {});
		const request = vi.fn().mockResolvedValue("0xsig");
		mocks.getSignClient.mockResolvedValue({ request });

		const provider = createWalletConnectProvider("t", BASE);
		await provider.request({ method: "personal_sign", params: ["0x1", "0xabc"] });

		expect(mocks.assertAllowed).not.toHaveBeenCalled();
	});
});
```

Add to that file's hoisted mocks and imports:

```typescript
	assertAllowed: vi.fn(),
```

```typescript
vi.mock("../policy/enforce.js", () => ({ assertAllowed: mocks.assertAllowed }));
```

```typescript
import { FibxError } from "../../lib/errors.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/walletconnect/provider.test.ts`
Expected: FAIL — the blocked transaction still reaches `request`.

- [ ] **Step 3: Add the gate**

In `src/services/walletconnect/provider.ts`, add the import:

```typescript
import { assertAllowed } from "../policy/enforce.js";
```

In `request()`, inside the existing `eth_sendTransaction` branch, before `ensureChain()`:

```typescript
			if (method === "eth_sendTransaction") {
				// The wallet path has no local account, so the fields arrive as
				// hex in the params. Checking here means a refusal never becomes
				// a confusing request on the user's phone.
				const tx = (params[0] ?? {}) as { to?: string; value?: string };
				assertAllowed({
					chain: chain.name,
					to: tx.to,
					value: tx.value ? BigInt(tx.value) : 0n,
				});

				await ensureChain();
			}
```

- [ ] **Step 4: Run the tests**

Run: `./node_modules/.bin/vitest run`
Expected: PASS, including the four new tests.

Then `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/eslint src/`.

- [ ] **Step 5: Commit**

```bash
git add src/services/walletconnect/provider.ts src/services/walletconnect/provider.test.ts
git commit -m "feat: apply the signing policy to the WalletConnect path

Checked before the chain repair and before the relay, so a refusal never
becomes a confusing request on the user's phone. The wallet path carries
hex fields rather than a viem account, so they are normalised here."
```

---

### Task 6: `fibx policy`

**Files:**
- Create: `src/commands/policy/index.ts`
- Test: `src/commands/policy/set.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `loadPolicy`, `savePolicy`, `clearPolicy`, `policyPath` from the store; `CHAIN_NAMES`
- Produces:
  - `registerPolicyCommands(program: Command): void`
  - `applyRule(policy: Policy, rule: string, value: string): Policy` — pure, exported for testing

A limit the user cannot read is a limit they will be surprised by, so `show` matters as much as `set`. `applyRule` is separated out because validating what goes into the file is the failure this command exists to prevent: a stored value the evaluator will not honour is worse than no policy.

- [ ] **Step 1: Write the failing test**

Create `src/commands/policy/set.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { applyRule } from "./index.js";

describe("applyRule", () => {
	it("sets a per-chain cap", () => {
		expect(applyRule({}, "base.maxValue", "0.05")).toEqual({ maxValue: { base: "0.05" } });
	});

	it("keeps rules already set for other chains", () => {
		const before = { maxValue: { base: "0.05" } };

		expect(applyRule(before, "monad.maxValue", "10")).toEqual({
			maxValue: { base: "0.05", monad: "10" },
		});
	});

	it("sets the chain allowlist from a comma-separated list", () => {
		expect(applyRule({}, "allowedChains", "base,monad")).toEqual({
			allowedChains: ["base", "monad"],
		});
	});

	it("sets per-chain destinations from a comma-separated list", () => {
		const value = "0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222";

		expect(applyRule({}, "base.allowedDestinations", value)).toEqual({
			allowedDestinations: {
				base: [
					"0x1111111111111111111111111111111111111111",
					"0x2222222222222222222222222222222222222222",
				],
			},
		});
	});

	it("sets an expiry", () => {
		expect(applyRule({}, "expiry", "2026-12-31")).toEqual({ expiry: "2026-12-31" });
	});

	// Storing a value the evaluator will not honour is the failure this
	// validation exists to prevent.
	it("refuses a cap that is not a number", () => {
		expect(() => applyRule({}, "base.maxValue", "lots")).toThrow(/number/i);
	});

	it("refuses an unknown chain", () => {
		expect(() => applyRule({}, "solana.maxValue", "1")).toThrow(/solana/);
	});

	it("refuses an unknown rule", () => {
		expect(() => applyRule({}, "base.maxGas", "1")).toThrow(/maxGas/);
	});

	it("refuses a malformed date", () => {
		expect(() => applyRule({}, "expiry", "next tuesday")).toThrow(/date/i);
	});

	it("refuses a destination that is not an address", () => {
		expect(() => applyRule({}, "base.allowedDestinations", "not-an-address")).toThrow(
			/address/i
		);
	});

	it("refuses a chain allowlist naming a chain FibX does not offer", () => {
		expect(() => applyRule({}, "allowedChains", "base,solana")).toThrow(/solana/);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/commands/policy/set.test.ts`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 3: Write the command**

Create `src/commands/policy/index.ts`:

```typescript
import type { Command } from "commander";
import chalk from "chalk";
import { CHAIN_NAMES } from "../../services/chain/constants.js";
import { clearPolicy, loadPolicy, policyPath, savePolicy } from "../../services/policy/store.js";
import type { Policy } from "../../services/policy/types.js";
import { formatError, success, warn } from "../../lib/format.js";

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function assertChain(chain: string): void {
	if (!(CHAIN_NAMES as readonly string[]).includes(chain)) {
		throw new Error(`Unknown chain: ${chain}. Known: ${CHAIN_NAMES.join(", ")}.`);
	}
}

/**
 * Applies one rule to a policy and returns the result. Pure, and validating —
 * storing a value the evaluator will not honour is worse than storing nothing,
 * because the user believes they have a limit they do not have.
 */
export function applyRule(policy: Policy, rule: string, value: string): Policy {
	const next: Policy = { ...policy };

	if (rule === "expiry") {
		if (Number.isNaN(new Date(value).getTime())) {
			throw new Error(`"${value}" is not a date. Use YYYY-MM-DD.`);
		}
		next.expiry = value;
		return next;
	}

	if (rule === "allowedChains") {
		const chains = value.split(",").map((c) => c.trim()).filter(Boolean);
		chains.forEach(assertChain);
		next.allowedChains = chains;
		return next;
	}

	const [chain, chainRule] = rule.split(".");
	if (!chain || !chainRule) {
		throw new Error(
			`Unknown rule: ${rule}. Try <chain>.maxValue, <chain>.allowedDestinations, allowedChains or expiry.`
		);
	}
	assertChain(chain);

	if (chainRule === "maxValue") {
		if (!/^\d+(\.\d+)?$/.test(value)) {
			throw new Error(`"${value}" is not a number. Give an amount in native units, e.g. 0.05.`);
		}
		next.maxValue = { ...next.maxValue, [chain]: value };
		return next;
	}

	if (chainRule === "allowedDestinations") {
		const addresses = value.split(",").map((a) => a.trim()).filter(Boolean);
		for (const address of addresses) {
			if (!ADDRESS.test(address)) {
				throw new Error(`"${address}" is not an address.`);
			}
		}
		next.allowedDestinations = { ...next.allowedDestinations, [chain]: addresses };
		return next;
	}

	throw new Error(
		`Unknown rule: ${chainRule}. Try maxValue or allowedDestinations.`
	);
}

function show(): void {
	const policy = loadPolicy();

	if (policy === "unreadable") {
		console.log(warn(`Policy at ${policyPath()} cannot be read, so nothing will be signed.`));
		console.log(chalk.gray("Fix the file, or remove it with `fibx policy clear`."));
		return;
	}

	if (!policy || Object.keys(policy).length === 0) {
		console.log(warn("No signing policy set — nothing limits what this wallet will sign."));
		console.log(
			chalk.gray(
				"On the imported-key path this is the only bound there would be.\n" +
					"Set one with, for example: fibx policy set base.maxValue 0.05"
			)
		);
		return;
	}

	console.log();
	if (policy.expiry) console.log(`  expiry              ${policy.expiry}`);
	if (policy.allowedChains) console.log(`  allowedChains       ${policy.allowedChains.join(", ")}`);
	for (const [chain, cap] of Object.entries(policy.maxValue ?? {})) {
		console.log(`  ${chain}.maxValue${" ".repeat(Math.max(1, 10 - chain.length))}${cap}`);
	}
	for (const [chain, list] of Object.entries(policy.allowedDestinations ?? {})) {
		console.log(`  ${chain}.allowedDestinations`);
		for (const address of list) console.log(`    ${address}`);
	}
	console.log();
}

export function registerPolicyCommands(program: Command) {
	const policyCmd = program
		.command("policy")
		.description("Read and change the local signing policy");

	policyCmd
		.command("show")
		.description("Print the active signing policy")
		.action(show);

	policyCmd
		.command("set")
		.description("Set one rule")
		.argument("<rule>", "expiry, allowedChains, <chain>.maxValue or <chain>.allowedDestinations")
		.argument("<value>", "The value; comma-separated for lists")
		.addHelpText(
			"after",
			"\nExamples:\n" +
				"  $ fibx policy set base.maxValue 0.05\n" +
				"  $ fibx policy set allowedChains base,monad\n" +
				"  $ fibx policy set expiry 2026-12-31"
		)
		.action((rule: string, value: string) => {
			const current = loadPolicy();
			if (current === "unreadable") {
				console.error(
					formatError(
						new Error(
							`Policy at ${policyPath()} cannot be read. Fix it, or run \`fibx policy clear\` to start over.`
						)
					)
				);
				process.exitCode = 1;
				return;
			}

			try {
				savePolicy(applyRule(current ?? {}, rule, value));
				console.log(success(`Set ${rule} to ${value}`));
			} catch (error) {
				console.error(formatError(error));
				process.exitCode = 1;
			}
		});

	policyCmd
		.command("clear")
		.description("Remove one rule, or the whole policy")
		.argument("[rule]", "The rule to remove; omit to remove everything")
		.action((rule?: string) => {
			if (!rule) {
				clearPolicy();
				console.log(success("Signing policy removed — nothing limits signing now."));
				return;
			}

			const current = loadPolicy();
			if (!current || current === "unreadable") {
				console.log(warn("No readable policy to change."));
				return;
			}

			const next = { ...current } as Record<string, unknown>;
			const [chain, chainRule] = rule.split(".");
			if (chainRule && chain) {
				const group = next[chainRule] as Record<string, unknown> | undefined;
				if (group) delete group[chain];
			} else {
				delete next[rule];
			}

			savePolicy(next as Policy);
			console.log(success(`Removed ${rule}`));
		});
}
```

- [ ] **Step 4: Register the command**

In `src/index.ts`, beside the existing `registerConfigCommands` import:

```typescript
import { registerPolicyCommands } from "./commands/policy/index.js";
```

And beside its call:

```typescript
registerPolicyCommands(program);
```

- [ ] **Step 5: Run the tests and the command**

Run: `./node_modules/.bin/vitest run src/commands/policy/set.test.ts`
Expected: PASS, 11 tests.

Then build and exercise it, checking the file lands where the store says:

```bash
./node_modules/.bin/tsup && node dist/index.js policy show && node dist/index.js policy set base.maxValue 0.05 && node dist/index.js policy show && node dist/index.js policy clear
```

Expected: the first `show` reports no policy; `set` confirms; the second `show` prints the cap; `clear` confirms removal.

- [ ] **Step 6: Commit**

```bash
git add src/commands/policy/index.ts src/commands/policy/set.test.ts src/index.ts
git commit -m "feat: add fibx policy show/set/clear

The blocked-transaction message tells the user how to change a limit, so
the command it names has to exist. set validates before storing, because
a value the evaluator will not honour is worse than no policy — the user
believes they have a limit they do not have."
```

---

### Task 7: `fibx auth setup`

**Files:**
- Create: `src/commands/auth/setup.ts`
- Test: `src/commands/auth/setup.test.ts`
- Modify: `src/index.ts`, `src/services/auth/session.ts`

**Interfaces:**
- Consumes: the existing auth commands, imported dynamically
- Produces:
  - `routeChoice(choice: string): "connect" | "privy" | "import" | "explain"` — pure
  - `authSetupCommand(opts: OutputOptions): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/commands/auth/setup.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { routeChoice } from "./setup.js";

describe("routeChoice", () => {
	it("routes a wallet the user already has to WalletConnect", () => {
		expect(routeChoice("1")).toBe("connect");
	});

	it("routes an unattended wallet to Privy", () => {
		expect(routeChoice("2")).toBe("privy");
	});

	it("routes a private key to import", () => {
		expect(routeChoice("3")).toBe("import");
	});

	// The combination the research found unavailable. It gets an explanation
	// rather than a path, which is the honest answer.
	it("routes the unavailable combination to an explanation", () => {
		expect(routeChoice("?")).toBe("explain");
	});

	it("treats anything else as the explanation too, rather than guessing", () => {
		expect(routeChoice("")).toBe("explain");
		expect(routeChoice("4")).toBe("explain");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run src/commands/auth/setup.test.ts`
Expected: FAIL — cannot resolve `./setup.js`.

- [ ] **Step 3: Write the command**

Create `src/commands/auth/setup.ts`:

```typescript
import inquirer from "inquirer";
import chalk from "chalk";
import { formatError, type OutputOptions } from "../../lib/format.js";

export type Route = "connect" | "privy" | "import" | "explain";

/**
 * Pure so the routing is testable without driving a prompt.
 *
 * Anything unrecognised routes to the explanation rather than to a path: this
 * command hands someone their signing setup, and guessing at that is worse than
 * saying what the options are.
 */
export function routeChoice(choice: string): Route {
	if (choice === "1") return "connect";
	if (choice === "2") return "privy";
	if (choice === "3") return "import";
	return "explain";
}

const EXPLANATION = `
  You want to keep your own wallet AND have FibX act while you are away.
  That combination is not available today, and it is worth knowing why.

  It needs ERC-7715 — a standard that lets a wallet grant a scoped,
  expiring permission instead of approving each transaction. Wallets do
  not yet expose it over WalletConnect, and the one implementation that
  exists routes through a hosted co-signer, which puts a third party back
  in the path.

  The closest options:

    Connect your wallet (1) keeps your keys where they are. Every
    transaction is approved on your phone.

    Import a key (3) runs unattended on this machine, and you set the
    limits yourself with \`fibx policy\`.
`;

export async function authSetupCommand(opts: OutputOptions): Promise<void> {
	try {
		if (!process.stdout.isTTY) {
			console.error(
				formatError(
					new Error(
						"`fibx auth setup` asks questions, so it needs a terminal. Use `fibx auth connect`, `fibx auth login <email>` or `fibx auth import` directly."
					)
				)
			);
			process.exitCode = 1;
			return;
		}

		const { choice } = await inquirer.prompt<{ choice: string }>([
			{
				type: "list",
				name: "choice",
				message: "How should FibX sign?",
				choices: [
					{ name: "Connect a wallet I already have — approved on your phone", value: "1" },
					{ name: "Create a wallet FibX can use on its own — bounded by Privy", value: "2" },
					{ name: "Import a private key — unattended, limits are yours to set", value: "3" },
					{ name: "I want my own wallet AND unattended operation", value: "?" },
				],
			},
		]);

		const route = routeChoice(choice);

		if (route === "explain") {
			console.log(chalk.gray(EXPLANATION));
			return;
		}

		if (route === "connect") {
			const { authConnectCommand } = await import("./connect.js");
			await authConnectCommand(opts);
			return;
		}

		if (route === "import") {
			const { authImportCommand } = await import("./import.js");
			await authImportCommand(opts);
			console.log(
				chalk.gray(
					"\n  This path has no limits until you set some.\n" +
						"  Start with: fibx policy set base.maxValue 0.05\n"
				)
			);
			return;
		}

		const { email } = await inquirer.prompt<{ email: string }>([
			{ type: "input", name: "email", message: "Email for the one-time code:" },
		]);
		const { authLoginCommand } = await import("./login.js");
		await authLoginCommand(email, opts);
	} catch (error) {
		console.error(formatError(error));
		process.exitCode = 1;
	}
}
```

- [ ] **Step 4: Register it and fix the unauthenticated message**

In `src/index.ts`, after the `auth.command("connect")` block:

```typescript
auth.command("setup")
	.description("Choose how FibX should sign, with the trade-offs explained")
	.action(async (_opts, cmd) => {
		const globalOpts = cmd.parent!.parent!.opts();
		const { authSetupCommand } = await import("./commands/auth/setup.js");
		await authSetupCommand({ json: globalOpts.json });
	});
```

In `src/services/auth/session.ts`, change the message in `requireSession()`:

```typescript
			"Not authenticated. Run `fibx auth setup` to choose how FibX should sign."
```

It named one of three paths, so every new user was steered to Privy without learning the other two exist.

- [ ] **Step 5: Run the tests and check the command is reachable**

Run: `./node_modules/.bin/vitest run`
Expected: PASS, including the five new tests.

```bash
./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/ && ./node_modules/.bin/tsup
node dist/index.js auth --help
```

Expected: `setup` listed.

Do **not** run `node dist/index.js auth setup` — choices 1 and 2 open a real pairing or send a real OTP. Task 8 covers it with a human present.

- [ ] **Step 6: Document it**

In `README.md`, replace the authentication section's list of commands with this
table and the line under it:

```markdown
### Choosing how FibX signs

Run `fibx auth setup` and it will ask. The three paths differ on one thing:

| Path | Key held by | Runs while you are away | Bounded by |
| --- | --- | --- | --- |
| `auth connect` | your own wallet | no | you, on your phone |
| `auth login` | Privy | yes | Privy's signing policy |
| `auth import` | this machine | yes | the local policy you set |

Keeping your own wallet *and* having FibX act unattended needs ERC-7715, which
wallets do not yet expose over WalletConnect. `fibx auth setup` explains the
closest options.
```

Then add a policy section covering `fibx policy show/set/clear` with the
examples from the command's own help, and this paragraph verbatim:

```markdown
A local policy guarding a local key is advisory: anything that can read the
key can edit the policy, so this is worth nothing against malware. What it
does bound is the agent — a model that misbehaves, or a prompt injection
telling it to. "Drain the wallet" hits the cap.
```

- [ ] **Step 7: Commit**

```bash
git add src/commands/auth/setup.ts src/commands/auth/setup.test.ts src/index.ts src/services/auth/session.ts README.md
git commit -m "feat: add fibx auth setup, and stop steering everyone to Privy

requireSession named one of three paths, so every new user was pointed at
Privy without learning the other two exist. The setup command asks what
someone needs and routes them, and answers the combination that is not
available with why rather than a shrug."
```

---

### Task 8: Manual verification

No unit test proves this works end to end — the policy has to refuse a real transaction on a real path, and the onboarding has to be driven by a human. This task is the gate on calling the feature done.

**Files:** none

- [ ] **Step 1: Build**

```bash
./node_modules/.bin/tsup
```

- [ ] **Step 2: Confirm nothing changed for someone with no policy**

```bash
node dist/index.js policy show
```

Expected: reports no policy, and says the imported-key path would have no other bound.

```bash
node dist/index.js balance --chain base
```

Expected: works exactly as before.

- [ ] **Step 3: Set a low cap and watch a real transfer refuse**

```bash
node dist/index.js policy set base.maxValue 0.00001
```

```bash
node dist/index.js send 0.0001 <your-second-address> --chain base
```

Expected: `[POLICY_BLOCKED]` naming both figures and pointing at `fibx policy show`. **No request reaches your phone** — that is the part worth watching, since a refusal that still prompts is not a gate.

- [ ] **Step 4: Raise the cap and watch the same transfer succeed**

```bash
node dist/index.js policy set base.maxValue 0.01
```

```bash
node dist/index.js send 0.0001 <your-second-address> --chain base
```

Expected: the request appears in the wallet, and confirming returns a hash.

- [ ] **Step 5: Check the destination allowlist**

```bash
node dist/index.js policy set base.allowedDestinations 0x0000000000000000000000000000000000000001
```

```bash
node dist/index.js send 0.0001 <your-second-address> --chain base
```

Expected: refused, naming the destination.

- [ ] **Step 6: Check expiry**

```bash
node dist/index.js policy set expiry 2020-01-01
```

```bash
node dist/index.js balance --chain base
```

Expected: `balance` still works — it signs nothing. Then:

```bash
node dist/index.js send 0.0001 <your-second-address> --chain base
```

Expected: refused, naming the expiry.

- [ ] **Step 7: Check that a corrupt policy refuses**

```bash
echo '{ not json' > "$(node -e "console.log(require('env-paths')('fibx').config)")/policy.json"
```

```bash
node dist/index.js send 0.0001 <your-second-address> --chain base
```

Expected: refused, naming the file path.

```bash
node dist/index.js policy clear
```

- [ ] **Step 8: Check the gate on the account path too**

Steps 3 to 7 exercise the WalletConnect adapter. The account adapter is a
different piece of code, and it guards the path that has no other bound, so it
needs its own look. A refusal needs no funds, so use a throwaway key for an
empty address — one generated for this test and used nowhere else:

```bash
node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.log(k, privateKeyToAccount(k).address)"
```

Import it, set a cap of zero, and attempt a transfer:

```bash
node dist/index.js auth import
```

```bash
node dist/index.js policy set base.maxValue 0
```

```bash
node dist/index.js send 0.0001 0x0000000000000000000000000000000000000001 --chain base
```

Expected: `[POLICY_BLOCKED]` naming the cap — refused by the policy, not by the
empty balance. Then reconnect the real wallet:

```bash
node dist/index.js auth connect
```

- [ ] **Step 9: Walk the onboarding**

```bash
node dist/index.js auth setup
```

Expected: the four choices appear. Pick `?` first and read the explanation. Then pick 1 and confirm it starts a pairing.

- [ ] **Step 10: Commit the verification note**

```bash
git commit --allow-empty -m "chore: verify the signing policy and onboarding by hand

A real transfer refused under a low cap without reaching the phone, then
succeeded when the cap was raised. Destination, expiry and corrupt-file
refusals all behaved. The account adapter refused on an imported throwaway
key, so both gates are checked rather than one. With no policy set, every
path behaved as before."
```

---

## Out of scope — do not do these here

- ERC-7715 session keys, and the `sessionHasMethod` probe that would detect support.
- Signed intents and any executor.
- A daily cumulative spend cap.
- Changing how `auth login`, `auth import` or `auth connect` behave. This plan adds a gate in front of them and a way to choose between them; it does not alter any of them.
- `fibx-server`, `fibx-telegram-bot`, `fibx-skills`.
