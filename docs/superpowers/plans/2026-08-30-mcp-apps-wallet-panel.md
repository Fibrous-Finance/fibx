# MCP Apps Wallet Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an interactive wallet panel that renders inside MCP hosts, covering pairing, session state, and the signing policy — and close the gap where the MCP surface cannot see the policy at all.

**Architecture:** A single self-contained HTML document, built by Vite from Preact sources and inlined into the tsup bundle as a string. It is served as a `ui://` resource and bound to the read-only `get_auth_status` tool, so opening the panel starts nothing. Everything the panel does, it does by calling server tools through `app.callServerTool()`.

**Tech Stack:** Preact, Vite + `vite-plugin-singlefile`, `@modelcontextprotocol/ext-apps` v1.7.5, the existing `@modelcontextprotocol/sdk` ^1.27.1, tsup, vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-mcp-apps-wallet-panel-design.md`

## Global Constraints

- **`dependencies` in package.json stays absent.** Everything ships bundled via tsup with `noExternal: [/.*/]`. New packages go in `devDependencies` only: `vite`, `vite-plugin-singlefile`, `preact`, `@modelcontextprotocol/ext-apps`.
- Code style: tabs for indentation, double quotes, semicolons.
- ESM throughout: imports carry `.js` extensions even for TypeScript sources. No `require()` in source.
- Tests are vitest, colocated as `<name>.test.ts` beside the source.
- **Never let a test touch the real config directory.** `policyPath()` and `sessionPath()` resolve to the actual `~/Library/Preferences/fibx-nodejs`, and `env-paths` ignores `XDG_CONFIG_HOME` on macOS. Mock `../../lib/config.js` the way `src/services/policy/store.test.ts` does.
- **The panel binds to `get_auth_status` and nothing else.** `connect_wallet` opens a real pairing as a side effect; binding the UI to it would tear down a session merely by rendering.
- The three-state policy read (`Policy | null | "unreadable"`) must survive into every new tool. Collapsing "unreadable" into "absent" is the fail-open the policy exists to prevent.
- No second implementation of the rule grammar. The new tools call the same `applyRule` / `removeRule` / `loadPolicy` / `savePolicy` the CLI uses.
- Every panel action keeps its CLI equivalent. Nothing is removed from the CLI.

## File Structure

**Create:**

- `ui/index.html` — the panel's entry document
- `ui/src/main.tsx` — Preact entry, `App` wiring, host connection
- `ui/src/panel.tsx` — the panel component, both states
- `ui/src/status.ts` — pure helpers (status mapping, rule formatting) so the logic is testable without a DOM
- `ui/src/status.test.ts` — tests for those helpers
- `ui/src/tokens.css` — design tokens lifted from `fibrous-interface/ds-bundle/_ds_bundle.css`
- `ui/vite.config.ts` — Vite config, root `ui/`, single-file output
- `ui/tsconfig.json` — JSX config for Preact
- `src/types/html.d.ts` — ambient declaration so `import html from "*.html"` typechecks
- `src/mcp/ui.ts` — the `ui://` URI constant and `registerWalletPanel`
- `src/mcp/tools/policy.ts` — `get_policy`, `set_policy_rule`, `clear_policy_rule`
- `src/mcp/handlers/policy.ts` — their handlers
- `src/mcp/handlers/policy.test.ts` — handler tests

**Modify:**

- `src/mcp/tools/auth.ts` — `get_auth_status` becomes an app tool; add `logout`
- `src/mcp/handlers/auth.ts` — add `handleLogout`
- `src/mcp/tools/index.ts` — register the policy tools, bump the tool count
- `src/mcp/server.ts` — call `registerWalletPanel`
- `src/commands/policy/index.ts` — export `isEmptyPolicy` (currently module-private at line 162)
- `tsup.config.ts` — add the `.html` text loader
- `package.json` — `build:ui` script, chained into `build`
- `tsconfig.json` — include `src/types`
- `.gitignore` — `ui/dist/`

---

### Task 1: The build pipeline and a panel that renders

This task exists to answer one question: does a locally-configured stdio server get its MCP App rendered at all? `ext-apps` issue #671 says maybe not. Everything after this task is contingent on the answer, so the panel here is deliberately the smallest thing that proves the pipeline end to end.

**Files:**

- Create: `ui/index.html`, `ui/src/main.tsx`, `ui/vite.config.ts`, `ui/tsconfig.json`, `src/types/html.d.ts`, `src/mcp/ui.ts`
- Modify: `src/mcp/tools/auth.ts`, `src/mcp/server.ts`, `tsup.config.ts`, `package.json`, `tsconfig.json`, `.gitignore`
- Test: `src/mcp/ui.test.ts`

**Interfaces:**

- Produces: `WALLET_PANEL_URI` (the `ui://` string) and `registerWalletPanel(server)`, both from `src/mcp/ui.ts`. Later tasks import the URI to assert the binding.

- [ ] **Step 1: Add the dependencies**

```bash
pnpm add -D vite vite-plugin-singlefile preact @modelcontextprotocol/ext-apps
```

Then confirm `dependencies` is still absent from package.json:

```bash
node -e "const p=require('./package.json'); if (p.dependencies) { console.error('FAIL: dependencies key exists'); process.exit(1); } console.log('ok')"
```

- [ ] **Step 2: Write the Vite config**

`ui/vite.config.ts`. `jsxImportSource` avoids needing `@preact/preset-vite` — one fewer dependency.

```typescript
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
	root: "ui",
	plugins: [viteSingleFile()],
	esbuild: { jsx: "automatic", jsxImportSource: "preact" },
	build: { outDir: "dist", emptyOutDir: true },
});
```

- [ ] **Step 3: Write the UI tsconfig**

`ui/tsconfig.json`:

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "ESNext",
		"moduleResolution": "bundler",
		"jsx": "react-jsx",
		"jsxImportSource": "preact",
		"strict": true,
		"skipLibCheck": true,
		"noEmit": true,
		"types": []
	},
	"include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- [ ] **Step 4: Write the minimal panel**

`ui/index.html`:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<title>FibX Wallet</title>
	</head>
	<body>
		<div id="root"></div>
		<script type="module" src="/src/main.tsx"></script>
	</body>
</html>
```

`ui/src/main.tsx`. `data-fibx-panel` is the marker Step 9's test greps for — it proves the built HTML is the one being served, not an empty file.

```tsx
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { App } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "FibX Wallet", version: "1.0.0" });

function Panel() {
	const [status, setStatus] = useState<string>("waiting for the host…");

	useEffect(() => {
		app.ontoolresult = (result) => {
			const text = result.content?.find((c) => c.type === "text")?.text;
			setStatus(text ?? "[no result]");
		};
		app.connect();
	}, []);

	return (
		<div data-fibx-panel>
			<h1>FibX Wallet</h1>
			<pre>{status}</pre>
		</div>
	);
}

render(<Panel />, document.getElementById("root")!);
```

- [ ] **Step 5: Build the UI and confirm it is one file**

```bash
pnpm exec vite build -c ui/vite.config.ts
```

Expected: `ui/dist/index.html` exists and contains no `<script src=` referencing a separate file.

```bash
node -e "const h=require('fs').readFileSync('ui/dist/index.html','utf8'); if (/<script[^>]+src=/.test(h)) { console.error('FAIL: not inlined'); process.exit(1); } console.log('inlined, ' + h.length + ' bytes')"
```

- [ ] **Step 6: Teach tsup and tsc about `.html`**

`src/types/html.d.ts`:

```typescript
declare module "*.html" {
	const html: string;
	export default html;
}
```

In `tsup.config.ts`, inside the existing `esbuildOptions(options)`, after the `options.define` block:

```typescript
options.loader = {
	...options.loader,
	// The panel is a build artifact, not a dependency: Vite bundles it
	// into one self-contained file and esbuild inlines that file's text
	// into the server bundle.
	".html": "text",
};
```

In `tsconfig.json`, make sure `include` covers `src/types` (add it if `include` lists directories explicitly).

- [ ] **Step 7: Register the resource**

`src/mcp/ui.ts`:

```typescript
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import panelHtml from "../../ui/dist/index.html";

export const WALLET_PANEL_URI = "ui://fibx/wallet-panel.html";

/** The built panel, as the host will receive it. Exported for tests. */
export const walletPanelHtml: string = panelHtml;

export function registerWalletPanel(server: McpServer): void {
	registerAppResource(
		server,
		WALLET_PANEL_URI,
		WALLET_PANEL_URI,
		{ mimeType: RESOURCE_MIME_TYPE },
		async () => ({
			contents: [
				{ uri: WALLET_PANEL_URI, mimeType: RESOURCE_MIME_TYPE, text: walletPanelHtml },
			],
		})
	);
}
```

- [ ] **Step 8: Bind the panel to `get_auth_status`**

In `src/mcp/tools/auth.ts`, import `registerAppTool` from `@modelcontextprotocol/ext-apps/server` and `WALLET_PANEL_URI` from `../ui.js`, then change the `get_auth_status` registration from `server.registerTool(...)` to `registerAppTool(server, ...)` with the same name, config and handler, adding one field to the config:

```typescript
			_meta: { ui: { resourceUri: WALLET_PANEL_URI } },
```

Leave the existing `annotations` exactly as they are — `readOnlyHint: true` is what makes opening the panel inert, and it is load-bearing.

In `src/mcp/server.ts`, call `registerWalletPanel(server)` next to `registerTools(server)`.

- [ ] **Step 9: Write the failing test**

`src/mcp/ui.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { WALLET_PANEL_URI, walletPanelHtml } from "./ui.js";

describe("the wallet panel resource", () => {
	it("uses the ui:// scheme the host looks for", () => {
		expect(WALLET_PANEL_URI.startsWith("ui://")).toBe(true);
	});

	// Proves the tsup loader inlined the built document rather than a path or
	// an empty string — the failure this catches is a build wiring mistake,
	// which no other test would notice.
	it("carries the built panel, inlined", () => {
		expect(walletPanelHtml).toContain("data-fibx-panel");
		expect(walletPanelHtml).not.toMatch(/<script[^>]+src=/);
	});
});
```

- [ ] **Step 10: Run it**

Run: `pnpm exec vitest run src/mcp/ui.test.ts`
Expected: PASS, 2 tests. If `walletPanelHtml` is a path rather than HTML, the `.html` loader is not wired.

- [ ] **Step 11: Chain the UI build**

In `package.json`:

```json
		"build:ui": "vite build -c ui/vite.config.ts",
		"build": "pnpm build:ui && tsup",
```

Add `ui/dist/` to `.gitignore`.

- [ ] **Step 12: Verify the whole build**

```bash
pnpm build && pnpm test && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/
```

Expected: all clean, test count up by 2.

- [ ] **Step 13: Commit**

```bash
git add -A && git commit -m "feat: serve a wallet panel as an MCP App resource"
```

- [ ] **Step 14: THE GATE — verify it renders**

**Stop here and hand this to the human partner.** Nothing after this task is worth building until this is answered.

Point Claude Desktop at the local build by adding it to the MCP config as a stdio server running `node <repo>/dist/index.js mcp-start`, restart Claude Desktop, then ask it to check the wallet status.

Expected: a panel renders inline showing "FibX Wallet" and the JSON `get_auth_status` returned.

If instead only text appears, `ext-apps` issue #671 applies to this case. Report that, skip Tasks 5 to 8, and do Tasks 2 to 4 anyway — they close a real gap in the MCP surface and do not depend on rendering.

---

### Task 2: The `get_policy` tool

The MCP surface has no notion of the signing policy. An agent blocked by it cannot read what blocked it. This is the read half.

**Files:**

- Create: `src/mcp/tools/policy.ts`, `src/mcp/handlers/policy.ts`, `src/mcp/handlers/policy.test.ts`
- Modify: `src/commands/policy/index.ts` (export `isEmptyPolicy`), `src/mcp/tools/index.ts`

**Interfaces:**

- Consumes: `loadPolicy()`, `policyPath()` from `../../services/policy/store.js`; `isEmptyPolicy` from `../../commands/policy/index.js`
- Produces: `handleGetPolicy()`, returning `{ state: "active" | "absent" | "unreadable", rules?, path }`

- [ ] **Step 1: Export `isEmptyPolicy`**

In `src/commands/policy/index.ts`, line 162, change `function isEmptyPolicy` to `export function isEmptyPolicy`. It already exists and is already correct; it is only private.

- [ ] **Step 2: Write the failing test**

`src/mcp/handlers/policy.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
	loadPolicy: vi.fn(),
	savePolicy: vi.fn(),
	clearPolicy: vi.fn(),
}));

vi.mock("../../services/policy/store.js", () => ({
	loadPolicy: mocks.loadPolicy,
	savePolicy: mocks.savePolicy,
	clearPolicy: mocks.clearPolicy,
	policyPath: () => "/tmp/does-not-exist/policy.json",
}));

const { handleGetPolicy } = await import("./policy.js");

/** The handlers return MCP content blocks; this reads the JSON back out. */
function parse(result: { content: { type: string; text: string }[] }) {
	return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("get_policy", () => {
	it("reports the active rules", async () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "0.05" } });

		const out = parse(await handleGetPolicy());

		expect(out.state).toBe("active");
		expect(out.rules).toEqual({ maxValue: { base: "0.05" } });
	});

	it("reports absence, which permits everything", async () => {
		mocks.loadPolicy.mockReturnValue(null);

		expect(parse(await handleGetPolicy()).state).toBe("absent");
	});

	// The distinction that must never be lost: a file that is present but
	// cannot be trusted refuses every transaction, and saying "absent" here
	// would tell the caller the opposite of the truth.
	it("keeps unreadable distinct from absent", async () => {
		mocks.loadPolicy.mockReturnValue("unreadable");

		const out = parse(await handleGetPolicy());

		expect(out.state).toBe("unreadable");
		expect(out.rules).toBeUndefined();
	});

	// A policy whose groups are all empty is reachable by hand-editing, and
	// bounds nothing — reporting it as active would be misleading.
	it("treats an empty policy as absent", async () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: {} });

		expect(parse(await handleGetPolicy()).state).toBe("absent");
	});
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm exec vitest run src/mcp/handlers/policy.test.ts`
Expected: FAIL — `./policy.js` does not exist.

- [ ] **Step 4: Write the handler**

`src/mcp/handlers/policy.ts`:

```typescript
import { loadPolicy, policyPath } from "../../services/policy/store.js";
import { isEmptyPolicy } from "../../commands/policy/index.js";
import { jsonResult } from "./utils.js";

/**
 * Reads the signing policy without changing it.
 *
 * The three states are the point. "unreadable" means a file is there and
 * cannot be trusted, which refuses every transaction — reporting it as
 * "absent" would tell the caller that nothing is blocking them when in fact
 * everything is.
 */
export async function handleGetPolicy() {
	const policy = loadPolicy();
	const path = policyPath();

	if (policy === "unreadable") {
		return jsonResult({
			state: "unreadable",
			path,
			message:
				"The policy file cannot be read, so nothing will be signed until it is fixed or removed.",
		});
	}

	if (!policy || isEmptyPolicy(policy)) {
		return jsonResult({
			state: "absent",
			path,
			message: "No signing policy is set — nothing limits what this wallet will sign.",
		});
	}

	return jsonResult({ state: "active", rules: policy, path });
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run src/mcp/handlers/policy.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Register the tool**

`src/mcp/tools/policy.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleGetPolicy } from "../handlers/policy.js";
import { withErrorHandling } from "./error-handling.js";

export function registerPolicyTools(server: McpServer): number {
	server.registerTool(
		"get_policy",
		{
			title: "Read the Signing Policy",
			description:
				"Read the local signing policy that bounds every transaction fibx signs. " +
				"Returns active with its rules, absent when nothing is set, or unreadable " +
				"when a file is present but cannot be parsed — which refuses everything.",
			inputSchema: {},
			annotations: {
				title: "Signing Policy",
				// Reads one file. No session write, no chain call, no relay.
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		withErrorHandling(handleGetPolicy)
	);

	return 1;
}
```

In `src/mcp/tools/index.ts`, import `registerPolicyTools` and add its return value to the tool count the way the other groups are summed.

- [ ] **Step 7: Verify**

```bash
pnpm test && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/ && ./node_modules/.bin/prettier --check src/
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: let MCP callers read the signing policy that blocks them"
```

---

### Task 3: The `set_policy_rule` and `clear_policy_rule` tools

The write half. These are the tools that make the panel's editing possible, and they are the ones a host will prompt about.

**Files:**

- Modify: `src/mcp/handlers/policy.ts`, `src/mcp/handlers/policy.test.ts`, `src/mcp/tools/policy.ts`

**Interfaces:**

- Consumes: `applyRule`, `removeRule` from `../../commands/policy/index.js`; `savePolicy`, `clearPolicy` from the store
- Produces: `handleSetPolicyRule({ rule, value })`, `handleClearPolicyRule({ rule? })`

- [ ] **Step 1: Write the failing tests**

Append to `src/mcp/handlers/policy.test.ts`:

```typescript
const { handleSetPolicyRule, handleClearPolicyRule } = await import("./policy.js");

describe("set_policy_rule", () => {
	it("applies a rule onto the existing policy and saves it", async () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "0.05" } });

		const out = parse(await handleSetPolicyRule({ rule: "base.maxValue", value: "0.01" }));

		expect(mocks.savePolicy).toHaveBeenCalledWith({ maxValue: { base: "0.01" } });
		expect(out.ok).toBe(true);
	});

	it("starts a policy when none exists", async () => {
		mocks.loadPolicy.mockReturnValue(null);

		await handleSetPolicyRule({ rule: "expiry", value: "2026-12-31" });

		expect(mocks.savePolicy).toHaveBeenCalledWith({ expiry: "2026-12-31" });
	});

	// Writing on top of a file we could not parse would silently discard
	// whatever the user had, so refuse and name the file instead.
	it("refuses to write over an unreadable policy", async () => {
		mocks.loadPolicy.mockReturnValue("unreadable");

		await expect(
			handleSetPolicyRule({ rule: "expiry", value: "2026-12-31" })
		).rejects.toThrow();
		expect(mocks.savePolicy).not.toHaveBeenCalled();
	});

	it("rejects an unknown rule rather than storing it", async () => {
		mocks.loadPolicy.mockReturnValue(null);

		await expect(handleSetPolicyRule({ rule: "nonsense", value: "1" })).rejects.toThrow();
		expect(mocks.savePolicy).not.toHaveBeenCalled();
	});
});

describe("clear_policy_rule", () => {
	it("removes one rule and saves the rest", async () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "0.05" }, expiry: "2026-12-31" });

		await handleClearPolicyRule({ rule: "expiry" });

		expect(mocks.savePolicy).toHaveBeenCalledWith({ maxValue: { base: "0.05" } });
	});

	// Asking to remove something that is not set is a normal thing to do and
	// is not a failure — it just did not change anything.
	it("reports no change when the rule was never set", async () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "0.05" } });

		const out = parse(await handleClearPolicyRule({ rule: "expiry" }));

		expect(out.changed).toBe(false);
		expect(mocks.savePolicy).not.toHaveBeenCalled();
	});

	it("removes the whole policy when no rule is named", async () => {
		mocks.loadPolicy.mockReturnValue({ maxValue: { base: "0.05" } });

		await handleClearPolicyRule({});

		expect(mocks.clearPolicy).toHaveBeenCalled();
		expect(mocks.savePolicy).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run src/mcp/handlers/policy.test.ts`
Expected: FAIL — the two handlers are not exported yet.

- [ ] **Step 3: Write the handlers**

Append to `src/mcp/handlers/policy.ts`:

```typescript
import { applyRule, removeRule } from "../../commands/policy/index.js";
import { savePolicy, clearPolicy } from "../../services/policy/store.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";

/** Shared by both writers: refuse to act on a file we could not parse. */
function readForWrite() {
	const policy = loadPolicy();
	if (policy === "unreadable") {
		throw new FibxError(
			ErrorCode.POLICY_BLOCKED,
			`The policy at ${policyPath()} cannot be read. Fix it, or clear it, before changing rules — ` +
				`writing over it would discard whatever it holds.`
		);
	}
	return policy;
}

export async function handleSetPolicyRule({ rule, value }: { rule: string; value: string }) {
	const current = readForWrite();
	// applyRule throws FibxError on an unknown rule, chain, address or number.
	// Letting that propagate keeps one grammar and one set of messages.
	const next = applyRule(current ?? {}, rule, value);
	savePolicy(next);
	return jsonResult({ ok: true, rule, value, rules: next });
}

export async function handleClearPolicyRule({ rule }: { rule?: string }) {
	if (!rule) {
		clearPolicy();
		return jsonResult({
			ok: true,
			changed: true,
			message: "Signing policy removed — nothing limits signing now.",
		});
	}

	const current = readForWrite();
	// removeRule returns null when the rule is valid but was never set, and
	// throws when the rule name itself is wrong. Two different answers.
	const next = current ? removeRule(current, rule) : null;
	if (!next) {
		return jsonResult({ ok: true, changed: false, message: `${rule} was not set.` });
	}

	savePolicy(next);
	return jsonResult({ ok: true, changed: true, rule, rules: next });
}
```

`removeRule`'s contract, read from `src/commands/policy/index.ts:109` so the implementer does not have to guess: it returns `null` **only** when the rule was validly named but never set, throws on an invalid rule name or unknown chain, and already deletes a group that becomes empty. It never signals "the policy is now empty" — an empty `{}` is a normal return.

Mirror the CLI exactly and `savePolicy(next)` even when the result is empty. The CLI's `clear <rule>` does not delete the file in that case, and `get_policy` already reports an empty policy as absent, so the two agree without a special case. Adding one here would make the MCP path behave differently from the CLI on the same file.

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run src/mcp/handlers/policy.test.ts`
Expected: PASS, 11 tests total in the file.

- [ ] **Step 5: Register both tools**

In `src/mcp/tools/policy.ts`, add two registrations and return `3`:

```typescript
server.registerTool(
	"set_policy_rule",
	{
		title: "Set a Signing Policy Rule",
		description:
			"Set one rule on the local signing policy. Rules: expiry, allowedChains, " +
			"<chain>.maxValue, <chain>.allowedDestinations. Lists are comma-separated. " +
			"maxValue caps the native value of one transaction and does not bound token " +
			"amounts — an ERC-20 transfer carries value 0 — so use allowedDestinations " +
			"to bound where tokens may go.",
		inputSchema: {
			rule: z
				.string()
				.describe("expiry, allowedChains, <chain>.maxValue or <chain>.allowedDestinations"),
			value: z.string().describe("The value; comma-separated for lists"),
		},
		annotations: {
			title: "Set Policy Rule",
			// Writes the file that bounds every signature. Hosts key their
			// approval prompt off this, and a rule can loosen as well as
			// tighten, so it must never claim to be read-only.
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		},
	},
	withErrorHandling(handleSetPolicyRule)
);

server.registerTool(
	"clear_policy_rule",
	{
		title: "Remove a Signing Policy Rule",
		description:
			"Remove one rule from the local signing policy, or omit the rule to remove " +
			"the policy entirely. Removing everything leaves nothing limiting what this " +
			"wallet will sign.",
		inputSchema: {
			rule: z
				.string()
				.optional()
				.describe("The rule to remove; omit to remove the whole policy"),
		},
		annotations: {
			title: "Clear Policy Rule",
			// Removing the policy lifts every bound there is.
			readOnlyHint: false,
			destructiveHint: true,
			openWorldHint: false,
		},
	},
	withErrorHandling(handleClearPolicyRule)
);
```

- [ ] **Step 6: Verify and commit**

```bash
pnpm test && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/ && ./node_modules/.bin/prettier --check src/
```

```bash
git add -A && git commit -m "feat: let MCP callers set and clear signing policy rules"
```

---

### Task 4: The `logout` tool

The CLI can end a session; MCP cannot. The panel needs it, and its absence is a gap regardless.

**Files:**

- Modify: `src/mcp/handlers/auth.ts`, `src/mcp/handlers/auth.test.ts`, `src/mcp/tools/auth.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/mcp/handlers/auth.test.ts`, following that file's existing mock setup:

```typescript
describe("logout", () => {
	it("releases the pairing before clearing the session", async () => {
		await handleLogout();

		expect(mocks.releaseWalletConnectSession).toHaveBeenCalled();
		expect(mocks.clearSession).toHaveBeenCalled();
		expect(mocks.releaseWalletConnectSession.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.clearSession.mock.invocationCallOrder[0]
		);
	});

	// The user asked to leave. Whatever became of the wallet's side, the local
	// session goes — otherwise a teardown failure leaves them logged in.
	it("clears the session even when releasing the pairing fails", async () => {
		mocks.releaseWalletConnectSession.mockRejectedValue(new Error("relay down"));

		await expect(handleLogout()).rejects.toThrow();
		expect(mocks.clearSession).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/mcp/handlers/auth.test.ts`
Expected: FAIL — `handleLogout` is not exported.

- [ ] **Step 3: Write the handler**

In `src/mcp/handlers/auth.ts`, mirroring `src/commands/auth/logout.ts` exactly:

```typescript
export async function handleLogout() {
	try {
		await releaseWalletConnectSession();
	} finally {
		// The user asked to leave. Whatever became of the wallet's side, the
		// local session goes — a teardown problem is still reported, but it
		// never leaves them logged in.
		clearSession();
	}
	return jsonResult({ ok: true, message: "Logged out. Session cleared." });
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run src/mcp/handlers/auth.test.ts`
Expected: PASS, 2 new tests.

- [ ] **Step 5: Register the tool**

In `src/mcp/tools/auth.ts`, add a registration and bump the returned count from `4` to `5`:

```typescript
server.registerTool(
	"logout",
	{
		title: "End the Session",
		description:
			"Log out: end any WalletConnect pairing and clear the local session. " +
			"The user will need to authenticate again before signing anything.",
		inputSchema: {},
		annotations: {
			title: "Log Out",
			// Discards the session and reaches the relay to end the pairing.
			readOnlyHint: false,
			destructiveHint: true,
			openWorldHint: true,
		},
	},
	withErrorHandling(handleLogout)
);
```

- [ ] **Step 6: Verify and commit**

```bash
pnpm test && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/ && ./node_modules/.bin/prettier --check src/
```

```bash
git add -A && git commit -m "feat: add an MCP logout tool to match the CLI"
```

---

> **Re-specified at full resolution on 2026-09-01, after Task 1's gate passed.**
> Every interface below was read from the code or the installed `ext-apps`
> typings, not guessed: `app.openLink({ url })` resolves `{ isError?: boolean }`
> and never throws on a host refusal; `get_connect_status` returns
> `{ status, address?, error? }` and `"unknown"` for a pairing the server has
> forgotten; `connect_wallet` returns `{ uri, qrDataUri, pairingId }`;
> `get_balance` returns `{ wallet, chain, balances: Record<symbol, string> }`;
> `get_policy` returns `{ state: "active" | "absent" | "unreadable", rules?, path, message? }`;
> `clear_policy_rule` takes `{ rule }` or `{ all: true }`, never both. Design
> tokens in `fibrous-interface/ds-bundle/_ds_bundle.css` are RGB triplets
> (`--bg-primary: 247 248 248`), used as `rgb(var(--bg-primary))`.

### Task 5: The panel, disconnected — QR, status and connect

**Files:**

- Create: `ui/src/status.ts`, `ui/src/status.test.ts`, `ui/src/tokens.css`, `ui/src/panel.tsx`, `ui/src/rpc.ts`
- Modify: `ui/src/main.tsx`, `src/mcp/ui.test.ts`

**Interfaces:**

- Consumes: `connect_wallet` → `{ uri, qrDataUri, pairingId }`; `get_connect_status({ pairingId })` → `{ status: "pending" | "connected" | "failed" | "unknown", address?, error? }`; `get_auth_status` result (the tool the panel is bound to).
- Produces: `nextPoll`, `parseToolJson`, `shortAddress` from `status.ts`; `callJson` from `rpc.ts`; `<Panel>` from `panel.tsx` with a `Disconnected` view. Tasks 6–8 add to these files and must not rename them.

- [ ] **Step 1: Write the failing tests for the pure helpers**

`ui/src/status.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { nextPoll, parseToolJson, shortAddress } from "./status.js";

describe("nextPoll", () => {
	it("keeps polling while the pairing is pending", () => {
		expect(nextPoll({ status: "pending" }, 3)).toEqual({ action: "poll", attempt: 4 });
	});

	it("stops as soon as the wallet connects", () => {
		expect(nextPoll({ status: "connected" }, 3).action).toBe("stop");
	});

	it("stops on failure rather than polling a dead pairing", () => {
		expect(nextPoll({ status: "failed" }, 3).action).toBe("stop");
	});

	// A pairing the server no longer knows about will not become connected by
	// being asked again.
	it("stops on unknown", () => {
		expect(nextPoll({ status: "unknown" }, 3).action).toBe("stop");
	});

	// Without a ceiling a forgotten tab polls the server forever.
	it("gives up after the attempt ceiling", () => {
		expect(nextPoll({ status: "pending" }, 120).action).toBe("expired");
	});
});

describe("parseToolJson", () => {
	// Every fibx tool answers with one text content block holding JSON; this is
	// the one place that shape is decoded, so a host that adds blocks or a tool
	// that answers with prose fails here, loudly, instead of as `undefined`
	// deep inside a render.
	it("decodes the first text block", () => {
		const out = parseToolJson<{ ok: boolean }>({
			content: [{ type: "text", text: '{"ok":true}' }],
		});
		expect(out).toEqual({ ok: true });
	});

	it("throws on a result with no text block", () => {
		expect(() => parseToolJson({ content: [] })).toThrow(/no text/i);
	});

	it("throws on a text block that is not JSON", () => {
		expect(() => parseToolJson({ content: [{ type: "text", text: "nope" }] })).toThrow();
	});
});

describe("shortAddress", () => {
	it("keeps the first six and last four characters", () => {
		expect(shortAddress("0x036395BBb9a85B8E285a1323e46650738d543d44")).toBe("0x0363…3d44");
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run ui/src/status.test.ts`
Expected: FAIL — `./status.js` does not exist. `vitest.config.ts` already includes `ui/**/*.test.ts` (fix round of the whole-branch review); if it does not pick the file up, widen the glob there rather than moving the file.

- [ ] **Step 3: Write the helpers**

`ui/src/status.ts`:

```typescript
export type ConnectStatus = {
	status: "pending" | "connected" | "failed" | "unknown";
	address?: string;
	error?: string;
};

export type PollDecision =
	| { action: "poll"; attempt: number }
	| { action: "stop" }
	| { action: "expired" };

/** Roughly two minutes at one second per attempt. */
export const MAX_POLL_ATTEMPTS = 120;

/**
 * Pure so the polling rules are testable without a DOM or a timer. Only
 * "pending" is worth asking again about: connected is done, and failed and
 * unknown will not change by being asked twice.
 */
export function nextPoll(result: ConnectStatus, attempt: number): PollDecision {
	if (result.status !== "pending") return { action: "stop" };
	if (attempt >= MAX_POLL_ATTEMPTS) return { action: "expired" };
	return { action: "poll", attempt: attempt + 1 };
}

type ToolResultLike = { content?: Array<{ type: string; text?: string }> };

/**
 * Every fibx tool answers with a single text block holding JSON. Decode it in
 * one place, and fail loudly when the shape is not that — a silent `undefined`
 * would surface as a blank panel with nothing to grep for.
 */
export function parseToolJson<T>(result: ToolResultLike): T {
	const text = result.content?.find((c) => c.type === "text")?.text;
	if (text === undefined) throw new Error("Tool result carried no text block");
	return JSON.parse(text) as T;
}

export function shortAddress(address: string): string {
	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run ui/src/status.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the tool-call wrapper**

`ui/src/rpc.ts`. One place turns a tool call into typed JSON and turns `isError` into a thrown `Error` carrying the tool's own message — the panel never branches on an error _code_ for policy tools (their validation errors arrive as `UNKNOWN_ERROR` with the right message; see `HANDOFF.md`).

This listing was brought in line with the shipped file after the fix round: fix round `aa7fafb` added the `{ success: false }` body handling below, because that is the shape FibX's `withErrorHandling` (`src/mcp/tools/error-handling.ts`) actually returns for most tool failures, and the plan's original listing only handled `isError`.

```typescript
import type { App } from "@modelcontextprotocol/ext-apps";
import { parseToolJson } from "./status.js";

type FailureBody = { success?: boolean; error?: string; message?: string; rawMessage?: string };

/**
 * Call a server tool and decode its JSON.
 *
 * This server's tools report failure two different ways, and both have to be
 * caught here or a caller sees a broken success value instead of an error:
 *
 * - `isError: true` — the SDK sets this only when a handler throws past its
 *   own catch, which in practice is essentially just zod input-validation.
 * - a normal (non-error) result whose JSON body is `{ success: false, error,
 *   code, rawMessage }` — `withErrorHandling` (src/mcp/tools/error-handling.ts)
 *   catches every thrown error and returns this shape with no `isError` at
 *   all. This is how most tool failures actually arrive (relay unreachable,
 *   bad project id, a policy refusal, …).
 *
 * A body with no `success` field at all is a normal success — most tools
 * never set it, so `success` is only ever checked for `=== false`, never
 * required to be `true`.
 */
export async function callJson<T>(
	app: App,
	name: string,
	args: Record<string, unknown> = {}
): Promise<T> {
	const result = await app.callServerTool({ name, arguments: args });
	if (result.isError) {
		let message = "Tool call failed";
		try {
			const body = parseToolJson<{ error?: string; message?: string }>(result);
			message = body.error ?? body.message ?? message;
		} catch {
			const text = result.content?.find((c) => c.type === "text")?.text;
			if (text) message = text;
		}
		throw new Error(message);
	}
	const body = parseToolJson<FailureBody>(result);
	if (body.success === false) {
		throw new Error(body.error ?? body.message ?? body.rawMessage ?? "Tool call failed");
	}
	return body as T;
}
```

- [ ] **Step 6: Write the design tokens**

`ui/src/tokens.css`. Values are lifted from `fibrous-interface/ds-bundle/_ds_bundle.css` — the light and dark triplets for the handful of tokens the panel uses, plus the two families. **Do not copy the 369 KB file**; every byte is inlined into the server bundle. The `dark` class on the root mirrors the design system's own convention; the panel sets it from `prefers-color-scheme` in `main.tsx`.

```css
:root {
	--bg-primary: 247 248 248;
	--bg-secondary: 255 255 255;
	--bg-tertiary: 237 238 241;
	--text-primary: 20 22 25;
	--text-secondary: 74 90 94;
	--text-muted: 125 127 130;
	--brand-primary: 17 178 186;
	--brand-hover: 15 160 167;
	--status-success: 59 193 113;
	--status-warning: 255 184 0;
	--status-error: 255 100 124;
	--surface-stroke: 142 149 162;
	--font-display: "Urbanist", ui-sans-serif, system-ui, sans-serif;
	--font-rubik: "Rubik", ui-monospace, monospace;
}

:root.dark {
	--bg-primary: 27 31 44;
	--bg-secondary: 39 45 62;
	--bg-tertiary: 21 25 36;
	--text-primary: 255 255 255;
	--text-secondary: 163 179 181;
	--text-muted: 125 127 130;
	--surface-stroke: 68 83 113;
}

* {
	box-sizing: border-box;
}

body {
	margin: 0;
	padding: 16px;
	background: rgb(var(--bg-primary));
	color: rgb(var(--text-primary));
	font-family: var(--font-display);
	font-size: 15px;
	line-height: 1.5;
}

h1 {
	font-size: 1.15rem;
	font-weight: 700;
	margin: 0 0 12px;
}

.card {
	background: rgb(var(--bg-secondary));
	border: 1px solid rgb(var(--surface-stroke) / 0.35);
	border-radius: 10px;
	padding: 14px;
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.row {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-wrap: wrap;
}

.muted {
	color: rgb(var(--text-muted));
	font-size: 0.9rem;
}

.mono {
	font-family: var(--font-rubik);
	font-variant-numeric: tabular-nums;
	font-size: 0.9rem;
	word-break: break-all;
}

button {
	font: inherit;
	border: 0;
	border-radius: 8px;
	padding: 8px 14px;
	cursor: pointer;
	background: rgb(var(--brand-primary));
	color: #fff;
}

button:hover {
	background: rgb(var(--brand-hover));
}

button.ghost {
	background: rgb(var(--bg-tertiary));
	color: rgb(var(--text-primary));
}

button:disabled {
	opacity: 0.55;
	cursor: default;
}

.pill {
	font-family: var(--font-rubik);
	font-size: 0.72rem;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	padding: 3px 9px;
	border-radius: 999px;
	background: rgb(var(--bg-tertiary));
	color: rgb(var(--text-secondary));
}

.pill.ok {
	background: rgb(var(--status-success) / 0.15);
	color: rgb(var(--status-success));
}

.pill.warn {
	background: rgb(var(--status-warning) / 0.15);
	color: rgb(var(--status-warning));
}

.pill.err {
	background: rgb(var(--status-error) / 0.15);
	color: rgb(var(--status-error));
}

.qr {
	width: 220px;
	height: 220px;
	border-radius: 8px;
	background: #fff;
	padding: 8px;
	align-self: center;
}

textarea.uri {
	width: 100%;
	min-height: 64px;
	resize: vertical;
	font-family: var(--font-rubik);
	font-size: 0.78rem;
	background: rgb(var(--bg-tertiary));
	color: rgb(var(--text-primary));
	border: 1px solid rgb(var(--surface-stroke) / 0.35);
	border-radius: 8px;
	padding: 8px;
}

table {
	width: 100%;
	border-collapse: collapse;
}

td,
th {
	text-align: left;
	padding: 6px 4px;
	border-bottom: 1px solid rgb(var(--surface-stroke) / 0.2);
}

th {
	color: rgb(var(--text-muted));
	font-weight: 500;
	font-size: 0.8rem;
}

.error {
	color: rgb(var(--status-error));
	font-size: 0.9rem;
}
```

- [ ] **Step 7: Write the disconnected panel**

`ui/src/panel.tsx`. This file grows through Tasks 6–8; the state shape below is the one they extend.

```tsx
import { useEffect, useState } from "preact/hooks";
import type { App } from "@modelcontextprotocol/ext-apps";
import { callJson } from "./rpc.js";
import { nextPoll, type ConnectStatus } from "./status.js";

export type AuthStatus = {
	authenticated: boolean;
	walletAddress: string | null;
	sessionType: "walletconnect" | "privy" | "private-key" | null;
	chain: string;
	requiresApprovalPerTransaction: boolean;
	fibrousStatus: string;
};

type Pairing = { uri: string; qrDataUri: string; pairingId: string };
type ConnectPhase =
	| { kind: "idle" }
	| { kind: "opening" }
	| { kind: "waiting"; pairing: Pairing }
	| { kind: "expired"; pairing: Pairing }
	| { kind: "failed"; message: string };

export function Panel({ app, initial }: { app: App; initial: AuthStatus | null }) {
	const [auth, setAuth] = useState<AuthStatus | null>(initial);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => setAuth(initial), [initial]);

	async function refreshAuth() {
		try {
			setAuth(await callJson<AuthStatus>(app, "get_auth_status", {}));
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	if (!auth) {
		return (
			<div data-fibx-panel>
				<h1>FibX Wallet</h1>
				<p class="muted">waiting for the host…</p>
			</div>
		);
	}

	return (
		<div data-fibx-panel>
			<h1>FibX Wallet</h1>
			{error && <p class="error">{error}</p>}
			{auth.authenticated ? (
				<Connected app={app} auth={auth} onChange={refreshAuth} />
			) : (
				<Disconnected app={app} onConnected={refreshAuth} />
			)}
		</div>
	);
}

/** Placeholder until Task 7; keeps Task 5 compiling on its own. */
function Connected({ auth }: { app: App; auth: AuthStatus; onChange: () => Promise<void> }) {
	return (
		<div class="card">
			<div class="row">
				<span class="pill ok">connected</span>
				<span class="mono">{auth.walletAddress}</span>
			</div>
		</div>
	);
}

export function Disconnected({ app, onConnected }: { app: App; onConnected: () => Promise<void> }) {
	const [phase, setPhase] = useState<ConnectPhase>({ kind: "idle" });

	async function connect() {
		setPhase({ kind: "opening" });
		let pairing: Pairing;
		try {
			pairing = await callJson<Pairing>(app, "connect_wallet", {});
		} catch (e) {
			setPhase({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
			return;
		}
		setPhase({ kind: "waiting", pairing });

		// connect_wallet returns as soon as the pairing exists; approval happens
		// on someone's phone, so the answer arrives by polling, not by that call.
		let attempt = 0;
		for (;;) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			let result: ConnectStatus;
			try {
				result = await callJson<ConnectStatus>(app, "get_connect_status", {
					pairingId: pairing.pairingId,
				});
			} catch (e) {
				setPhase({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
				return;
			}
			const decision = nextPoll(result, attempt);
			if (decision.action === "expired") {
				setPhase({ kind: "expired", pairing });
				return;
			}
			if (decision.action === "stop") {
				if (result.status === "connected") {
					await onConnected();
					setPhase({ kind: "idle" });
				} else {
					setPhase({
						kind: "failed",
						message: result.error ?? `pairing ${result.status}`,
					});
				}
				return;
			}
			attempt = decision.attempt;
		}
	}

	async function copyUri(uri: string) {
		try {
			await navigator.clipboard.writeText(uri);
		} catch {
			// The sandbox may refuse the clipboard; the textarea is selectable
			// on purpose so the URI is never unreachable.
		}
	}

	if (phase.kind === "idle" || phase.kind === "opening" || phase.kind === "failed") {
		return (
			<div class="card">
				<p class="muted">No wallet is connected. Pair your own wallet to sign from it.</p>
				{phase.kind === "failed" && <p class="error">{phase.message}</p>}
				<button onClick={connect} disabled={phase.kind === "opening"}>
					{phase.kind === "opening" ? "Opening a pairing…" : "Connect a wallet"}
				</button>
			</div>
		);
	}

	const { pairing } = phase;
	return (
		<div class="card">
			<div class="row">
				<span class={`pill ${phase.kind === "expired" ? "warn" : ""}`}>
					{phase.kind === "expired" ? "expired" : "waiting for the wallet"}
				</span>
			</div>
			<img class="qr" src={pairing.qrDataUri} alt="WalletConnect pairing QR" />
			<textarea
				class="uri"
				readOnly
				value={pairing.uri}
				onFocus={(e) => e.currentTarget.select()}
			/>
			<div class="row">
				<button class="ghost" onClick={() => copyUri(pairing.uri)}>
					Copy link
				</button>
				{phase.kind === "expired" && <button onClick={connect}>Try again</button>}
			</div>
		</div>
	);
}
```

- [ ] **Step 8: Wire main.tsx to the panel**

Replace `ui/src/main.tsx` with:

```tsx
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { App } from "@modelcontextprotocol/ext-apps";
import { Panel, type AuthStatus } from "./panel.js";
import { parseToolJson } from "./status.js";
import "./tokens.css";

const app = new App({ name: "FibX Wallet", version: "1.0.0" });

if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
	document.documentElement.classList.add("dark");
}

function Root() {
	const [initial, setInitial] = useState<AuthStatus | null>(null);
	const [connectError, setConnectError] = useState<string | null>(null);

	useEffect(() => {
		app.addEventListener("toolresult", (result) => {
			try {
				setInitial(parseToolJson<AuthStatus>(result));
			} catch (e) {
				setConnectError(e instanceof Error ? e.message : String(e));
			}
		});

		// connect() rejects when the ui/initialize handshake fails. Keep that
		// visible: the gate that proved this pipeline relied on being able to
		// tell "never rendered" from "rendered, handshake failed".
		app.connect().catch((e: unknown) => setConnectError(`connect failed: ${String(e)}`));

		return () => {
			app.close().catch(() => {});
		};
	}, []);

	if (connectError) {
		return (
			<div data-fibx-panel>
				<h1>FibX Wallet</h1>
				<p class="error">{connectError}</p>
			</div>
		);
	}
	return <Panel app={app} initial={initial} />;
}

render(<Root />, document.getElementById("root")!);
```

- [ ] **Step 9: Add a size guard**

The whole-branch review measured the panel at 339 KB, almost all of it the SDK's schema layer pulled in by `App`. Nothing on this branch can shrink that without replacing `App`, which the handshake needs. What this step buys is that growth is noticed: add to `src/mcp/ui.test.ts`

```typescript
// The panel is inlined into the bundle every fibx invocation loads. The
// SDK layer sets the floor (~330 KB); the ceiling below leaves ~60 KB for
// the panel's own code and fails the suite before an accidental import
// doubles it.
it("stays under the size budget", () => {
	expect(walletPanelHtml.length).toBeLessThan(400_000);
});
```

- [ ] **Step 10: Verify**

```bash
pnpm build && pnpm test && ./node_modules/.bin/tsc --noEmit && pnpm typecheck:ui && ./node_modules/.bin/eslint src/ && ./node_modules/.bin/prettier --check src/ ui/
```

Expected: all clean; the build reports the panel's byte size — record it in the commit message.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat: pair a wallet from inside the panel"
```

---

### Task 6: Wallet shortcuts

**Files:** Modify `ui/src/panel.tsx`; create `ui/src/wallets.ts`, `ui/src/wallets.test.ts`

**Interfaces:**

- Consumes: `app.openLink({ url })` → `Promise<{ isError?: boolean }>`. **It does not throw on refusal** — a blocked domain or a user cancel comes back as `isError: true`. There is no host-capability flag to check beforehand; the only way to know is to try.

- [ ] **Step 1: Write the failing test**

`ui/src/wallets.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { walletLinks } from "./wallets.js";

const URI = "wc:abc@2?relay-protocol=irn&symKey=deadbeef";

describe("walletLinks", () => {
	// Each wallet consumes the URI through its own universal link; the encoding
	// must survive the `@`, `?` and `=` inside a wc: URI or the wallet opens
	// to nothing.
	it("encodes the pairing URI once, per wallet", () => {
		const links = walletLinks(URI);
		const encoded = encodeURIComponent(URI);
		expect(links.map((l) => l.name)).toEqual(["MetaMask", "Rabby", "Rainbow"]);
		for (const l of links) expect(l.url).toContain(encoded);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run ui/src/wallets.test.ts`
Expected: FAIL — `./wallets.js` does not exist.

- [ ] **Step 3: Write it**

`ui/src/wallets.ts`:

```typescript
export type WalletLink = { name: string; url: string };

/**
 * Same-device pairing: hand the wc: URI to a wallet through its universal
 * link instead of asking someone to scan their own screen. These are the
 * wallets FibX's own README names; the copyable URI remains for every other.
 */
export function walletLinks(uri: string): WalletLink[] {
	const u = encodeURIComponent(uri);
	return [
		{ name: "MetaMask", url: `https://metamask.app.link/wc?uri=${u}` },
		{ name: "Rabby", url: `https://rabby.io/wc?uri=${u}` },
		{ name: "Rainbow", url: `https://rnbwapp.com/wc?uri=${u}` },
	];
}
```

- [ ] **Step 4: Add the buttons, and hide them when the host says no**

In `Disconnected` (`ui/src/panel.tsx`), add state `const [linksAllowed, setLinksAllowed] = useState(true);` and, in the waiting/expired card, above the copy row:

```tsx
{
	linksAllowed && (
		<div class="row">
			{walletLinks(pairing.uri).map((l) => (
				<button
					class="ghost"
					onClick={async () => {
						const r = await app.openLink({ url: l.url });
						// A refusal is a result, not an exception. Once the host
						// says no, every shortcut would say no — drop them all
						// and leave the copyable URI, which always works.
						if (r.isError) setLinksAllowed(false);
					}}
				>
					Open in {l.name}
				</button>
			))}
		</div>
	);
}
```

Import `walletLinks` from `./wallets.js`.

- [ ] **Step 5: Verify and commit**

```bash
pnpm build && pnpm test && ./node_modules/.bin/tsc --noEmit && pnpm typecheck:ui
```

```bash
git add -A && git commit -m "feat: hand the pairing URI straight to the wallet"
```

---

### Task 7: The panel, connected

**Files:** Modify `ui/src/panel.tsx`, `ui/src/status.ts`, `ui/src/status.test.ts`

**Interfaces:**

- Consumes: `get_balance({ chain })` → `{ wallet, chain, balances: Record<string, string> }`; `logout` → `{ ok, message }`.
- Produces: `describeSession` from `status.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `ui/src/status.test.ts`:

```typescript
import { describeSession } from "./status.js";

describe("describeSession", () => {
	it("says a WalletConnect session approves on the phone", () => {
		const d = describeSession("walletconnect");
		expect(d.approvesPerTransaction).toBe(true);
		expect(d.policyIsOnlyBound).toBe(false);
	});

	it("says a Privy session runs unattended behind a server policy", () => {
		const d = describeSession("privy");
		expect(d.approvesPerTransaction).toBe(false);
		expect(d.policyIsOnlyBound).toBe(false);
	});

	// The path with no other bound. Worth saying out loud, since it is the one
	// where the local policy is the only thing between an agent and the key.
	it("flags the imported key as bounded by the local policy alone", () => {
		const d = describeSession("private-key");
		expect(d.approvesPerTransaction).toBe(false);
		expect(d.policyIsOnlyBound).toBe(true);
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run ui/src/status.test.ts`
Expected: FAIL — `describeSession` is not exported.

- [ ] **Step 3: Write it**

Append to `ui/src/status.ts`:

```typescript
export type SessionKind = "walletconnect" | "privy" | "private-key";

export function describeSession(kind: SessionKind): {
	label: string;
	approvesPerTransaction: boolean;
	policyIsOnlyBound: boolean;
} {
	switch (kind) {
		case "walletconnect":
			return {
				label: "Your own wallet, over WalletConnect",
				approvesPerTransaction: true,
				policyIsOnlyBound: false,
			};
		case "privy":
			return {
				label: "A Privy wallet",
				approvesPerTransaction: false,
				policyIsOnlyBound: false,
			};
		case "private-key":
			return {
				label: "A private key on this machine",
				approvesPerTransaction: false,
				policyIsOnlyBound: true,
			};
	}
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run ui/src/status.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Replace the Connected placeholder**

In `ui/src/panel.tsx`, replace the placeholder `Connected` with:

```tsx
type Balances = { wallet: string; chain: string; balances: Record<string, string> };

function Connected({
	app,
	auth,
	onChange,
}: {
	app: App;
	auth: AuthStatus;
	onChange: () => Promise<void>;
}) {
	const [balances, setBalances] = useState<Balances | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const session = describeSession(auth.sessionType ?? "walletconnect");

	useEffect(() => {
		let cancelled = false;
		callJson<Balances>(app, "get_balance", { chain: auth.chain })
			.then((b) => !cancelled && setBalances(b))
			.catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
		return () => {
			cancelled = true;
		};
	}, [auth.walletAddress, auth.chain]);

	async function endSession() {
		setBusy("Ending the session…");
		try {
			await callJson(app, "logout", {});
			await onChange();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	}

	return (
		<>
			<div class="card">
				<div class="row">
					<span class="pill ok">connected</span>
					<span class="pill">{auth.chain}</span>
					{session.approvesPerTransaction && (
						<span class="pill">approves on your phone</span>
					)}
					{session.policyIsOnlyBound && (
						<span class="pill warn">bounded by policy only</span>
					)}
				</div>
				<div class="mono" title={auth.walletAddress ?? ""}>
					{auth.walletAddress ? shortAddress(auth.walletAddress) : "—"}
				</div>
				<p class="muted">{session.label}</p>
				{error && <p class="error">{error}</p>}
				<div class="row">
					<button class="ghost" onClick={endSession} disabled={busy !== null}>
						{busy ?? "End session"}
					</button>
				</div>
			</div>

			<div class="card">
				<h1>Balances</h1>
				{balances ? (
					<table>
						<thead>
							<tr>
								<th>Asset</th>
								<th>Amount</th>
							</tr>
						</thead>
						<tbody>
							{Object.entries(balances.balances).map(([symbol, amount]) => (
								<tr key={symbol}>
									<td>{symbol}</td>
									<td class="mono">{amount}</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<p class="muted">loading…</p>
				)}
			</div>

			<PolicyCard app={app} sessionKind={auth.sessionType ?? "walletconnect"} />
		</>
	);
}

/** Placeholder until Task 8; keeps Task 7 compiling on its own. */
function PolicyCard(_: { app: App; sessionKind: SessionKind }) {
	return null;
}
```

Import `describeSession`, `shortAddress`, `type SessionKind` from `./status.js`.

- [ ] **Step 6: Verify and commit**

```bash
pnpm build && pnpm test && ./node_modules/.bin/tsc --noEmit && pnpm typecheck:ui
```

```bash
git add -A && git commit -m "feat: show what is signing, in the panel"
```

---

### Task 8: Policy display and editing

**Files:** Modify `ui/src/panel.tsx`, `ui/src/status.ts`, `ui/src/status.test.ts`

**Interfaces:**

- Consumes: `get_policy` → `{ state: "active" | "absent" | "unreadable"; rules?: Policy; path: string; message?: string }`; `set_policy_rule({ rule, value })`; `clear_policy_rule({ rule })` or `clear_policy_rule({ all: true })` — never both. Both writers are `readOnlyHint: false`, so the host prompts before running them; the panel must show that a confirmation is pending rather than looking frozen, and must refresh from `get_policy` afterwards rather than assuming its own write landed.
- Produces: `policyRows` from `status.ts`.

- [ ] **Step 1: Write the failing test**

Append to `ui/src/status.test.ts`:

```typescript
import { policyRows } from "./status.js";

describe("policyRows", () => {
	// The panel edits rules by the same names `fibx policy set` takes, so the
	// flattening has to produce exactly those names — one grammar, two surfaces.
	it("flattens a policy into the CLI's rule names", () => {
		const rows = policyRows({
			maxValue: { base: "0.05", monad: "1" },
			allowedChains: ["base", "monad"],
			allowedDestinations: { base: ["0xabc"] },
			expiry: "2026-12-31",
		});
		expect(rows).toEqual([
			{ rule: "expiry", value: "2026-12-31" },
			{ rule: "allowedChains", value: "base,monad" },
			{ rule: "base.maxValue", value: "0.05" },
			{ rule: "monad.maxValue", value: "1" },
			{ rule: "base.allowedDestinations", value: "0xabc" },
		]);
	});

	it("returns nothing for an empty policy", () => {
		expect(policyRows({})).toEqual([]);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run ui/src/status.test.ts`
Expected: FAIL — `policyRows` is not exported.

- [ ] **Step 3: Write it**

Append to `ui/src/status.ts`:

```typescript
export type Policy = {
	maxValue?: Record<string, string>;
	allowedChains?: string[];
	allowedDestinations?: Record<string, string[]>;
	expiry?: string;
};

export type PolicyRow = { rule: string; value: string };

/**
 * One row per rule, named exactly as `fibx policy set` names them, so the edit
 * form can send the row back through set_policy_rule unchanged.
 */
export function policyRows(policy: Policy): PolicyRow[] {
	const rows: PolicyRow[] = [];
	if (policy.expiry) rows.push({ rule: "expiry", value: policy.expiry });
	if (policy.allowedChains)
		rows.push({ rule: "allowedChains", value: policy.allowedChains.join(",") });
	for (const [chain, v] of Object.entries(policy.maxValue ?? {})) {
		rows.push({ rule: `${chain}.maxValue`, value: v });
	}
	for (const [chain, list] of Object.entries(policy.allowedDestinations ?? {})) {
		rows.push({ rule: `${chain}.allowedDestinations`, value: list.join(",") });
	}
	return rows;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run ui/src/status.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Replace the PolicyCard placeholder**

In `ui/src/panel.tsx`:

```tsx
type PolicyState =
	| { state: "active"; rules: Policy; path: string }
	| { state: "absent"; path: string; message: string }
	| { state: "unreadable"; path: string; message: string };

function PolicyCard({ app, sessionKind }: { app: App; sessionKind: SessionKind }) {
	const [policy, setPolicy] = useState<PolicyState | null>(null);
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [draft, setDraft] = useState<{ rule: string; value: string }>({
		rule: "base.maxValue",
		value: "",
	});

	async function load() {
		try {
			setPolicy(await callJson<PolicyState>(app, "get_policy", {}));
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	useEffect(() => {
		void load();
	}, []);

	// Every write goes through the host's approval prompt. While that prompt
	// is up the call has not returned, so say so — a frozen button reads as a
	// bug. And never trust our own write: reload from get_policy afterwards.
	async function write(label: string, name: string, args: Record<string, unknown>) {
		setPending(label);
		setError(null);
		try {
			await callJson(app, name, args);
			await load();
		} catch (e) {
			// Validation failures arrive with the right message and an
			// uninformative code — render the message, never branch on the code.
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setPending(null);
		}
	}

	if (!policy)
		return (
			<div class="card">
				<h1>Signing policy</h1>
				<p class="muted">loading…</p>
			</div>
		);

	return (
		<div class="card">
			<div class="row">
				<h1 style="margin:0">Signing policy</h1>
				{policy.state === "active" && <span class="pill ok">active</span>}
				{policy.state === "absent" && (
					<span class={`pill ${sessionKind === "private-key" ? "warn" : ""}`}>
						none set
					</span>
				)}
				{policy.state === "unreadable" && <span class="pill err">unreadable</span>}
			</div>

			{policy.state === "unreadable" && (
				<p class="error">
					{policy.message} <span class="mono">{policy.path}</span>
				</p>
			)}
			{policy.state === "absent" && (
				<p class="muted">
					{policy.message}
					{sessionKind === "private-key" &&
						" On an imported key this is the only bound there is."}
				</p>
			)}

			{policy.state === "active" && (
				<table>
					<tbody>
						{policyRows(policy.rules).map((row) => (
							<tr key={row.rule}>
								<td class="mono">{row.rule}</td>
								<td class="mono">{row.value}</td>
								<td>
									<button
										class="ghost"
										disabled={pending !== null}
										onClick={() =>
											write(`Removing ${row.rule}…`, "clear_policy_rule", {
												rule: row.rule,
											})
										}
									>
										Remove
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			{policy.state !== "unreadable" && (
				<form
					class="row"
					onSubmit={(e) => {
						e.preventDefault();
						if (!draft.value.trim()) return;
						void write(`Setting ${draft.rule}…`, "set_policy_rule", {
							rule: draft.rule,
							value: draft.value.trim(),
						});
					}}
				>
					<input
						class="mono"
						value={draft.rule}
						onInput={(e) => setDraft({ ...draft, rule: e.currentTarget.value })}
						placeholder="base.maxValue"
						aria-label="Rule"
					/>
					<input
						class="mono"
						value={draft.value}
						onInput={(e) => setDraft({ ...draft, value: e.currentTarget.value })}
						placeholder="0.05"
						aria-label="Value"
					/>
					<button type="submit" disabled={pending !== null}>
						{pending ?? "Set"}
					</button>
				</form>
			)}

			<p class="muted">
				maxValue caps the native value of one transaction. It does not bound token amounts —
				an ERC-20 transfer carries value 0 — so use allowedDestinations to bound where
				tokens may go.
			</p>

			{policy.state !== "absent" && (
				<div class="row">
					<button
						class="ghost"
						disabled={pending !== null}
						onClick={() => {
							// The host will prompt again; this local confirm keeps a
							// stray click from ever reaching that prompt.
							if (
								confirm(
									"Remove the whole signing policy? Nothing will limit signing afterwards."
								)
							) {
								void write("Removing the policy…", "clear_policy_rule", {
									all: true,
								});
							}
						}}
					>
						Remove whole policy
					</button>
				</div>
			)}
			{error && <p class="error">{error}</p>}
		</div>
	);
}
```

Import `policyRows`, `type Policy` from `./status.js`. Add to `tokens.css`:

```css
input.mono {
	font: inherit;
	font-family: var(--font-rubik);
	background: rgb(var(--bg-tertiary));
	color: rgb(var(--text-primary));
	border: 1px solid rgb(var(--surface-stroke) / 0.35);
	border-radius: 8px;
	padding: 7px 9px;
	min-width: 9rem;
}
```

- [ ] **Step 6: Verify and commit**

```bash
pnpm build && pnpm test && ./node_modules/.bin/tsc --noEmit && pnpm typecheck:ui && ./node_modules/.bin/eslint src/ && ./node_modules/.bin/prettier --check src/ ui/
```

```bash
git add -A && git commit -m "feat: read and edit the signing policy from the panel"
```

---

### Task 9: Manual verification

No automated test proves a panel renders and behaves in a real host. This is the gate on calling the feature done.

**Files:** none

- [ ] **Step 1: Build and point Claude Desktop at it**

```bash
pnpm build
```

- [ ] **Step 2: Disconnected state**

Log out first, then ask Claude to check the wallet. Expected: the panel renders with a QR. Scan it, approve in the wallet, and watch the panel move to connected without any further prompting.

- [ ] **Step 3: Shortcuts**

Press each wallet shortcut. Expected: the wallet opens with the pairing loaded, or the buttons are absent because the host refused the capability. Not a dead button.

- [ ] **Step 4: Connected state**

Expected: address, session type, chain and balance all match `fibx status` in a terminal.

- [ ] **Step 5: Policy round trip**

Set a cap from the panel. Expected: the host prompts for approval, and afterwards `fibx policy show` in a terminal reports the same rule. Then set one from the terminal and reopen the panel — it must show that one. One file, two views.

- [ ] **Step 6: Unreadable policy**

```bash
echo '{ not json' > ~/Library/Preferences/fibx-nodejs/policy.json
```

Expected: the panel says the file cannot be read and names it. It must not say "no policy set".

- [ ] **Step 7: Commit the verification note**

```bash
git commit --allow-empty -m "chore: verify the wallet panel by hand"
```

---

## Out of scope — do not do these here

- A swap or transfer confirmation screen. `send_tokens` and `swap_tokens` stay out of this panel.
- A portfolio dashboard.
- Any change to how the three signing paths work.
- A remote or hosted MCP server.
- Removing or narrowing any CLI command.
