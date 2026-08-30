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

> **A note on Tasks 5 to 8.** They are specified at a lower resolution than
> Tasks 1 to 4 — the pure logic and the tool wiring carry real code, but the
> markup does not. That is deliberate: every one of them is contingent on Task
> 1's gate, and writing speculative JSX for a panel that may not render is
> waste. **After Task 1's gate passes, re-specify Tasks 5 to 8 at full
> resolution before dispatching them.** Do not treat the prose here as a
> licence to improvise the parts that carry logic.

### Task 5: The panel, disconnected — QR, status and connect

**Only start this if Task 1's gate passed.**

**Files:**

- Create: `ui/src/panel.tsx`, `ui/src/status.ts`, `ui/src/status.test.ts`, `ui/src/tokens.css`
- Modify: `ui/src/main.tsx`

**Interfaces:**

- Consumes: `connect_wallet` (returns `{ uri, qr, pairingId }` — confirm the exact field names against `handleConnectWallet` in `src/mcp/handlers/auth.ts:117`) and `get_connect_status` (`{ pairingId }` → pending / connected / failed / unknown)

- [ ] **Step 1: Write the failing test for the pure part**

`ui/src/status.test.ts`. The polling logic is where the bugs live, so it goes in a pure function that a test can drive without a DOM.

```typescript
import { describe, expect, it } from "vitest";
import { nextPoll } from "./status.js";

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

	// A pairing the server no longer knows about is not going to become
	// connected by asking again.
	it("stops on unknown", () => {
		expect(nextPoll({ status: "unknown" }, 3).action).toBe("stop");
	});

	// Without a ceiling a forgotten tab polls the server forever.
	it("gives up after the attempt ceiling", () => {
		expect(nextPoll({ status: "pending" }, 120).action).toBe("expired");
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run ui/src/status.test.ts`
Expected: FAIL — `./status.js` does not exist. If vitest does not pick up `ui/`, add it to the `include` in `vitest.config.ts` (or create that config) rather than moving the file.

- [ ] **Step 3: Write the helper**

`ui/src/status.ts`:

```typescript
export type ConnectStatus = { status: "pending" | "connected" | "failed" | "unknown" };
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
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run ui/src/status.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Extract the design tokens**

Copy the CSS custom properties (the `--*` declarations, both light and dark) from `/Users/ahmetenesdur/workspace/fibrous-interface/ds-bundle/_ds_bundle.css` into `ui/src/tokens.css`, along with hand-written rules for only the classes the panel uses. Do not copy the whole 369 KB file — the panel needs a few dozen declarations, and every byte is inlined into the server bundle and refetched on each render.

- [ ] **Step 6: Write the disconnected panel**

`ui/src/panel.tsx`, rendering: the QR image returned by `connect_wallet`, the `wc:` URI as selectable text with a copy button, a status line driven by `nextPoll`, and a retry when it expires. Import `tokens.css` from `main.tsx`.

The connect flow. Field names are read from `handleConnectWallet` in `src/mcp/handlers/auth.ts:117`, which returns `{ uri, qrDataUri, pairingId }` — note `qrDataUri`, not `qr`:

```tsx
async function connect(
	setPairing: (p: { uri: string; qrDataUri: string }) => void,
	setStatus: (s: string) => void
) {
	setStatus("opening a pairing…");

	const started = await app.callServerTool({ name: "connect_wallet", arguments: {} });
	const { uri, qrDataUri, pairingId } = JSON.parse(
		started.content?.find((c) => c.type === "text")?.text ?? "{}"
	);
	setPairing({ uri, qrDataUri });
	setStatus("waiting for the wallet…");

	// connect_wallet returns as soon as the pairing exists; approval happens
	// on someone's phone, so the result arrives through polling rather than
	// through that call.
	let attempt = 0;
	for (;;) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		const polled = await app.callServerTool({
			name: "get_connect_status",
			arguments: { pairingId },
		});
		const result = JSON.parse(polled.content?.find((c) => c.type === "text")?.text ?? "{}");

		const decision = nextPoll(result, attempt);
		if (decision.action === "stop") return setStatus(result.status);
		if (decision.action === "expired") return setStatus("expired");
		attempt = decision.attempt;
	}
}
```

- [ ] **Step 7: Build and verify**

```bash
pnpm build && pnpm test && ./node_modules/.bin/tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: pair a wallet from inside the panel"
```

---

### Task 6: Wallet shortcuts

**Files:** Modify `ui/src/panel.tsx`

- [ ] **Step 1: Add the shortcuts**

Three buttons — MetaMask, Rabby, Rainbow — that hand the `wc:` URI to the wallet via the host's link capability (`app.sendOpenLink` or the equivalent named in the ext-apps API docs; confirm the method name against `@modelcontextprotocol/ext-apps`'s `App` type rather than guessing).

- [ ] **Step 2: Degrade when the host refuses**

Hosts may disable the link capability. Feature-detect it; when it is unavailable, render the copyable URI alone and no shortcut buttons. A dead button is worse than an absent one.

- [ ] **Step 3: Verify and commit**

```bash
pnpm build && pnpm test && ./node_modules/.bin/tsc --noEmit
```

```bash
git add -A && git commit -m "feat: hand the pairing URI straight to the wallet"
```

---

### Task 7: The panel, connected

**Files:** Modify `ui/src/panel.tsx`, `ui/src/status.ts`, `ui/src/status.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `ui/src/status.test.ts` a test for a pure `describeSession` helper that maps `get_auth_status`'s `sessionType` to what the reader needs to know:

```typescript
describe("describeSession", () => {
	it("says a WalletConnect session approves on the phone", () => {
		expect(describeSession("walletconnect").approvesPerTransaction).toBe(true);
	});

	it("says an imported key does not", () => {
		expect(describeSession("private-key").approvesPerTransaction).toBe(false);
	});

	// The path with no other bound: worth saying out loud, since it is the one
	// where the signing policy is the only thing standing between an agent and
	// the wallet.
	it("flags the imported key as unbounded without a policy", () => {
		expect(describeSession("private-key").policyIsOnlyBound).toBe(true);
	});
});
```

- [ ] **Step 2: Implement it, then render the connected state**

The address, the session type in plain words, the active chain, a balance summary from `get_balance`, and an "end session" button calling `logout`.

- [ ] **Step 3: Verify and commit**

```bash
pnpm build && pnpm test && ./node_modules/.bin/tsc --noEmit
```

```bash
git add -A && git commit -m "feat: show what is signing, in the panel"
```

---

### Task 8: Policy display and editing

**Files:** Modify `ui/src/panel.tsx`

- [ ] **Step 1: Render the rules**

Call `get_policy` and render its three states distinctly: active with its rules, absent with a prompt to set one, unreadable with the file path and what to do. Never render "unreadable" as "no policy".

- [ ] **Step 2: Add editing**

Per rule: an edit control and a remove control, calling `set_policy_rule` and `clear_policy_rule`. Since both are `readOnlyHint: false`, the host will prompt before each — the panel must show that a confirmation is pending rather than appearing frozen, and must refresh from `get_policy` after the call rather than assuming its own write succeeded.

- [ ] **Step 3: Say what the cap does not cover**

Next to `maxValue`, in the panel, state that it bounds native value only and that token transfers are bounded by `allowedDestinations`. This is the claim the README got wrong once; it should not be reintroduced silently in a UI.

- [ ] **Step 4: Verify and commit**

```bash
pnpm build && pnpm test && ./node_modules/.bin/tsc --noEmit
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
