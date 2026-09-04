# FibX App Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two chat surfaces (wallet panel, swap card) with one application — a small app.fibrous.finance inside the chat — opened by one tool, pre-filled by the conversation, and testable without Claude Desktop.

**Architecture:** One read-only tool, `open_fibx`, composes the existing auth/balance/policy/quote handlers into one snapshot and is the only tool bound to a `ui://` resource. One built document renders one app: header (chain, wallet), swap form (source, destination, price info, min received), footer (Simulate, Swap), collapsed policy section. The form is driven by a pure state machine; every error passes through a mapping layer; a dev host built on `ext-apps`' `AppBridge` renders the document locally against fixtures or a live server.

**Tech Stack:** Preact, Vite + `vite-plugin-singlefile`, `@modelcontextprotocol/ext-apps` 1.7.5 (`App` on the view side, `AppBridge` on the host side), `@modelcontextprotocol/sdk`, zod 4, vitest 4, `happy-dom` (new devDependency), tsup.

**Spec:** `docs/superpowers/specs/2026-09-05-fibx-app-widget-design.md`

## Global Constraints

- **`dependencies` in `package.json` must stay absent.** New packages go in `devDependencies` only, always. This plan adds exactly one: `happy-dom`.
- Code style: tabs for indentation, double quotes, semicolons. Prettier and ESLint are the arbiters (`eslint` covers `src/` only; `prettier --check src/ ui/`).
- ESM: imports carry `.js` extensions even for TypeScript sources, including inside `ui/`. No `require()` in source.
- Tests are vitest, colocated as `<name>.test.ts` (or `.test.tsx` for component tests) beside the source.
- **Never let a test touch the real config directory.** `policyPath()`, `sessionPath()` and `paths.cache` resolve to the real `~/Library/Preferences/fibx-nodejs` and `~/Library/Caches/fibx-nodejs`; `env-paths` ignores `XDG_CONFIG_HOME` on macOS, so environment variables isolate nothing. Mock the module, the way `src/mcp/handlers/trade.test.ts:23` mocks `../../services/chain/constants.js`.
- **No tool that moves money is ever called without a click.** The only automatic call the widget makes is `get_quote`, which is read-only. `swap_tokens` — simulate or broadcast — runs only from a user gesture.
- **`swap_tokens` keeps `readOnlyHint: false, destructiveHint: true` and no `_meta`.** Only `open_fibx` is bound to a UI resource.
- **A control that cannot work explains itself in place; it does not vanish.**
- **A raw error message never reaches the user.** Everything passes through `explainError`.
- **The bundle guard is 400 KB, measured in bytes** (`Buffer.byteLength(html, "utf8")`). It is never raised. The document is at 361,521 bytes at the start of this plan; the task that first adds UI measures, and every task after it reports the number.
- **Do not run `auth connect`, `auth login` or `auth setup` while testing.** Two of them open a real WalletConnect pairing or send a real OTP email.
- `loadPolicy()` returns three states, `Policy | null | "unreadable"`; the `"unreadable"` string must be checked first (`isEmptyPolicy("unreadable")` is `true`). Do not reorder the branches in `src/mcp/handlers/policy.ts`.

## File Structure

**Server — create:**

- `src/mcp/handlers/app.ts` — `handleOpenFibx`, `handleListTokens`: the snapshot and the token list
- `src/mcp/handlers/app.test.ts`
- `src/mcp/tools/app.ts` — registers `open_fibx` (bound to the app resource) and `list_tokens`
- `src/mcp/tools/app.test.ts` — binding, annotations, and that no other tool is bound

**Server — modify:**

- `src/mcp/handlers/utils.ts` — `unwrapJson<T>(result)` so one handler can compose others
- `src/mcp/ui.ts` — one URI, `APP_URI = "ui://fibx/app.html"`, `registerApp`; the two old URIs removed
- `src/mcp/ui.test.ts` — one resource, byte guard, `data-fibx-app` marker
- `src/mcp/tools/trade.ts` — `get_quote` back to `server.registerTool`, no `_meta`, one description line added
- `src/mcp/tools/auth.ts` — `get_auth_status` back to `server.registerTool`, no `_meta`
- `src/mcp/tools/index.ts` — the new category
- `src/mcp/server.ts` — `registerApp(server)`

**UI — create (pure, no DOM):**

- `ui/src/types.ts` — every tool-result shape the widget reads, in one place
- `ui/src/machine.ts` + `.test.ts` — the swap form's state machine
- `ui/src/errors.ts` + `.test.ts` — `explainError`
- `ui/src/tokens.ts` + `.test.ts` — popular tokens, search filter, ordering
- `ui/src/test-utils.ts` — `mount()` for component tests (happy-dom, no testing library)

**UI — create (components):**

- `ui/src/picker.tsx` + `.test.tsx` — the token picker
- `ui/src/pairing.tsx` + `.test.tsx` — the connect view, controls that explain rather than vanish
- `ui/src/policy.tsx` + `.test.tsx` — the collapsible policy section
- `ui/src/swap-form.tsx` + `.test.tsx` — the form, driven by `machine.ts`
- `ui/src/app.tsx` + `.test.tsx` — the shell: header, view switching, composition

**UI — modify:**

- `ui/src/rpc.ts` + `.test.ts` — `ToolError` carrying `code` and `details`
- `ui/src/main.tsx` — one surface
- `ui/src/quote.ts` — unchanged except the `Quote` re-export moving to `types.ts`
- `ui/src/tokens.css` — form layout classes
- `ui/index.html` — title

**UI — delete (Task 9):**

- `ui/src/panel.tsx`, `ui/src/swap-card.tsx`, `ui/src/wallets.ts`, `ui/src/wallets.test.ts`

**Dev host — create:**

- `ui/dev-host/index.html`, `ui/dev-host/host.ts`, `ui/dev-host/vite.config.ts`
- `ui/dev-host/fixtures/*.json`
- `ui/dev-host/bridge.ts` — the live relay (Node)

**Config — modify:**

- `package.json` — `happy-dom` devDependency; `dev:ui`, `dev:ui:bridge` scripts
- `vitest.config.ts` — `.test.tsx` in `include`, preact JSX
- `ui/tsconfig.json` — `dev-host/**/*.ts` in `include`
- `tsconfig.json` — `ui/dev-host/bridge.ts` in `include` (it is Node code)
- `docs/superpowers/HANDOFF.md`

---

### Task 1: The server contract — `open_fibx`, `list_tokens`, one resource

**Files:**

- Create: `src/mcp/handlers/app.ts`, `src/mcp/handlers/app.test.ts`, `src/mcp/tools/app.ts`, `src/mcp/tools/app.test.ts`
- Modify: `src/mcp/handlers/utils.ts`, `src/mcp/ui.ts`, `src/mcp/ui.test.ts`, `src/mcp/tools/trade.ts`, `src/mcp/tools/auth.ts`, `src/mcp/tools/index.ts`, `src/mcp/server.ts`

**Interfaces:**

- Consumes: `handleGetAuthStatus({ chain })`, `handleGetBalance({ chain })`, `handleGetPolicy()`, `handleGetQuote({ amount, from_token, to_token, chain, slippage })` — all return `{ content: [{ type: "text", text: <JSON> }] }`; `getTokens(chainConfig): Promise<TokenMap>` from `src/services/fibrous/tokens.js`; `getChainConfig(name)`; `ChainEnum` from `src/mcp/tools/schemas.js`; `slippageSchema`, `DEFAULT_SLIPPAGE`.
- Produces: `APP_URI`, `appHtml`, `registerApp(server)` from `src/mcp/ui.js`; the **snapshot shape** below, which every UI task reads; `list_tokens` → `{ chain, tokens: TokenInfo[] }`.

**The snapshot shape** — copy this into `ui/src/types.ts` in Task 2 unchanged:

```typescript
type Snapshot = {
	chain: string;
	auth: AuthStatus; // the get_auth_status body
	balances: Record<string, string> | null; // get_balance's `balances`, or null when not authenticated or when it failed
	policy: PolicyState; // the get_policy body
	terms: { from: string; to: string; amount: string; slippage: number } | null;
	quote: QuoteResult | null; // the get_quote body, when terms were given and it succeeded
	quoteError: string | null; // when terms were given and it failed — the app still opens
};
```

**A transitional note for the reviewer.** After this task, `open_fibx` serves the _existing_ built document, whose `main.tsx` still switches between the old panel and card. An `open_fibx` result has none of `input`/`output`/`rate` at the top level, so it will render the old panel with a nonsensical payload until Task 6 rewrites `main.tsx`. That is expected and is not a defect of this task; the branch is not usable end-to-end until Task 6.

- [ ] **Step 1: `unwrapJson` — the helper that lets one handler read another's result**

Append to `src/mcp/handlers/utils.ts`:

```typescript
/**
 * Read the JSON a handler wrote with jsonResult. open_fibx composes the
 * existing handlers rather than re-implementing them, and they all answer in
 * this one envelope.
 */
export function unwrapJson<T>(result: { content: { type: string; text: string }[] }): T {
	const text = result.content.find((c) => c.type === "text")?.text;
	if (text === undefined) throw new Error("handler result carried no text block");
	return JSON.parse(text) as T;
}
```

- [ ] **Step 2: Write the failing handler tests**

`src/mcp/handlers/app.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

// Every handler open_fibx composes is mocked at the module boundary, so this
// test reaches neither the network nor the real config directory
// (~/Library/Preferences/fibx-nodejs — a live session and an encrypted key).
const mocks = vi.hoisted(() => ({
	handleGetAuthStatus: vi.fn(),
	handleGetBalance: vi.fn(),
	handleGetPolicy: vi.fn(),
	handleGetQuote: vi.fn(),
	getTokens: vi.fn(),
	getChainConfig: vi.fn(),
}));

vi.mock("./auth.js", () => ({ handleGetAuthStatus: mocks.handleGetAuthStatus }));
vi.mock("./wallet.js", () => ({ handleGetBalance: mocks.handleGetBalance }));
vi.mock("./policy.js", () => ({ handleGetPolicy: mocks.handleGetPolicy }));
vi.mock("./quote.js", () => ({ handleGetQuote: mocks.handleGetQuote }));
vi.mock("../../services/fibrous/tokens.js", () => ({ getTokens: mocks.getTokens }));
vi.mock("../../services/chain/constants.js", () => ({
	getChainConfig: mocks.getChainConfig,
}));

const { handleOpenFibx, handleListTokens } = await import("./app.js");
const { jsonResult, unwrapJson } = await import("./utils.js");

const AUTHED = {
	authenticated: true,
	walletAddress: "0x0363000000000000000000000000000000003d44",
	sessionType: "walletconnect",
	chain: "base",
	requiresApprovalPerTransaction: true,
	fibrousStatus: "alive",
};
const ANON = { ...AUTHED, authenticated: false, walletAddress: null, sessionType: null };
const POLICY_ABSENT = { state: "absent", path: "/p", message: "No signing policy is set" };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getChainConfig.mockReturnValue({ name: "base", fibrousNetwork: "base" });
	mocks.handleGetPolicy.mockResolvedValue(jsonResult(POLICY_ABSENT));
});

describe("open_fibx", () => {
	it("opens bare: auth and policy, no balances, no terms, no quote", async () => {
		mocks.handleGetAuthStatus.mockResolvedValue(jsonResult(ANON));

		const snap = unwrapJson<Record<string, unknown>>(await handleOpenFibx({ chain: "base" }));

		expect(snap.chain).toBe("base");
		expect(snap.auth).toEqual(ANON);
		expect(snap.policy).toEqual(POLICY_ABSENT);
		expect(snap.balances).toBeNull();
		expect(snap.terms).toBeNull();
		expect(snap.quote).toBeNull();
		expect(snap.quoteError).toBeNull();
		expect(mocks.handleGetBalance).not.toHaveBeenCalled();
		expect(mocks.handleGetQuote).not.toHaveBeenCalled();
	});

	it("fetches balances only when authenticated", async () => {
		mocks.handleGetAuthStatus.mockResolvedValue(jsonResult(AUTHED));
		mocks.handleGetBalance.mockResolvedValue(
			jsonResult({ wallet: AUTHED.walletAddress, chain: "base", balances: { ETH: "0.0002" } })
		);

		const snap = unwrapJson<{ balances: unknown }>(await handleOpenFibx({ chain: "base" }));

		expect(snap.balances).toEqual({ ETH: "0.0002" });
		expect(mocks.handleGetBalance).toHaveBeenCalledWith({ chain: "base" });
	});

	// The app must open even when a part of it cannot be filled. A balance
	// fetch that fails is a blank balance, not a closed door.
	it("opens with null balances when the balance call fails", async () => {
		mocks.handleGetAuthStatus.mockResolvedValue(jsonResult(AUTHED));
		mocks.handleGetBalance.mockRejectedValue(new Error("rpc down"));

		const snap = unwrapJson<{ balances: unknown; auth: unknown }>(
			await handleOpenFibx({ chain: "base" })
		);

		expect(snap.balances).toBeNull();
		expect(snap.auth).toEqual(AUTHED);
	});

	it("pre-fills: terms are echoed and the quote is fetched with them", async () => {
		mocks.handleGetAuthStatus.mockResolvedValue(jsonResult(ANON));
		mocks.handleGetQuote.mockResolvedValue(
			jsonResult({ input: "0.001 ETH", output: "~2.45 USDC", rate: "r", chain: "base" })
		);

		const snap = unwrapJson<{ terms: unknown; quote: unknown }>(
			await handleOpenFibx({ chain: "base", from: "ETH", to: "USDC", amount: "0.001" })
		);

		expect(snap.terms).toEqual({ from: "ETH", to: "USDC", amount: "0.001", slippage: 0.5 });
		expect(mocks.handleGetQuote).toHaveBeenCalledWith({
			amount: "0.001",
			from_token: "ETH",
			to_token: "USDC",
			chain: "base",
			slippage: 0.5,
		});
		expect(snap.quote).toEqual({
			input: "0.001 ETH",
			output: "~2.45 USDC",
			rate: "r",
			chain: "base",
		});
	});

	// A quote that fails is the single most common way this tool will be
	// called with bad input ("swap 1 XYZ") — the app opens with the terms and
	// the reason, so the user can fix the token in the picker.
	it("opens with quoteError when the quote fails, keeping the terms", async () => {
		mocks.handleGetAuthStatus.mockResolvedValue(jsonResult(ANON));
		mocks.handleGetQuote.mockRejectedValue(new Error("Token not found: XYZ"));

		const snap = unwrapJson<{ terms: unknown; quote: unknown; quoteError: unknown }>(
			await handleOpenFibx({ chain: "base", from: "XYZ", to: "USDC", amount: "1" })
		);

		expect(snap.terms).toEqual({ from: "XYZ", to: "USDC", amount: "1", slippage: 0.5 });
		expect(snap.quote).toBeNull();
		expect(snap.quoteError).toBe("Token not found: XYZ");
	});

	it("treats partial terms as no terms", async () => {
		mocks.handleGetAuthStatus.mockResolvedValue(jsonResult(ANON));

		const snap = unwrapJson<{ terms: unknown }>(
			await handleOpenFibx({ chain: "base", from: "ETH" })
		);

		expect(snap.terms).toBeNull();
		expect(mocks.handleGetQuote).not.toHaveBeenCalled();
	});
});

describe("list_tokens", () => {
	it("returns the chain's tokens as a list sorted by symbol", async () => {
		mocks.getTokens.mockResolvedValue({
			"0xb": { symbol: "USDC", name: "USD Coin", address: "0xb", decimals: 6, price: "1" },
			"0xa": { symbol: "ETH", name: "Ether", address: "0xa", decimals: 18 },
		});

		const out = unwrapJson<{ chain: string; tokens: { symbol: string }[] }>(
			await handleListTokens({ chain: "base" })
		);

		expect(out.chain).toBe("base");
		expect(out.tokens.map((t) => t.symbol)).toEqual(["ETH", "USDC"]);
	});
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm exec vitest run src/mcp/handlers/app.test.ts`
Expected: FAIL — `./app.js` does not exist.

- [ ] **Step 4: Write the handlers**

`src/mcp/handlers/app.ts`:

```typescript
import { handleGetAuthStatus } from "./auth.js";
import { handleGetBalance } from "./wallet.js";
import { handleGetPolicy } from "./policy.js";
import { handleGetQuote } from "./quote.js";
import { jsonResult, unwrapJson } from "./utils.js";
import { getTokens, type Token } from "../../services/fibrous/tokens.js";
import { getChainConfig } from "../../services/chain/constants.js";
import { DEFAULT_SLIPPAGE } from "../../lib/config.js";

type AuthStatus = { authenticated: boolean; [k: string]: unknown };
type Balances = { balances: Record<string, string> };

export type OpenFibxArgs = {
	chain: string;
	from?: string;
	to?: string;
	amount?: string;
	slippage?: number;
};

/**
 * One snapshot for the app widget: everything the widget needs to draw itself
 * on first paint, composed from the handlers that already exist.
 *
 * Only auth and policy are required. Balances and the quote are attempted
 * and, when they fail, reported as absent — the app must open on a bad token
 * symbol or a slow RPC, because opening is how the user fixes either.
 */
export async function handleOpenFibx({ chain, from, to, amount, slippage }: OpenFibxArgs) {
	const auth = unwrapJson<AuthStatus>(await handleGetAuthStatus({ chain }));
	const policy = unwrapJson<unknown>(await handleGetPolicy());

	let balances: Record<string, string> | null = null;
	if (auth.authenticated) {
		try {
			balances = unwrapJson<Balances>(await handleGetBalance({ chain })).balances;
		} catch {
			balances = null;
		}
	}

	const terms =
		from && to && amount ? { from, to, amount, slippage: slippage ?? DEFAULT_SLIPPAGE } : null;

	let quote: unknown = null;
	let quoteError: string | null = null;
	if (terms) {
		try {
			quote = unwrapJson<unknown>(
				await handleGetQuote({
					amount: terms.amount,
					from_token: terms.from,
					to_token: terms.to,
					chain,
					slippage: terms.slippage,
				})
			);
		} catch (e) {
			quoteError = e instanceof Error ? e.message : String(e);
		}
	}

	return jsonResult({
		chain: getChainConfig(chain).name,
		auth,
		balances,
		policy,
		terms,
		quote,
		quoteError,
	});
}

export type TokenInfo = Pick<Token, "symbol" | "name" | "address" | "decimals" | "price">;

/** The chain's token list for the widget's picker. Headless; never bound to UI. */
export async function handleListTokens({ chain }: { chain: string }) {
	const chainConfig = getChainConfig(chain);
	const map = await getTokens(chainConfig);
	const tokens: TokenInfo[] = Object.values(map)
		.map(({ symbol, name, address, decimals, price }) => ({
			symbol,
			name,
			address,
			decimals,
			...(price !== undefined ? { price } : {}),
		}))
		.sort((a, b) => a.symbol.localeCompare(b.symbol));
	return jsonResult({ chain: chainConfig.name, tokens });
}
```

- [ ] **Step 5: Run the handler tests**

Run: `pnpm exec vitest run src/mcp/handlers/app.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: One resource in `src/mcp/ui.ts`**

Replace the file's exports and functions (keep the explanatory comment about the single built document, rewritten to say there is now one URI):

```typescript
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import documentHtml from "../../ui/dist/index.html";

// vite-plugin-singlefile inlines everything the document imports — including
// the SDK's `App` schema layer, ~330 KB by itself — into ONE self-contained
// HTML file, which esbuild then inlines as text into the server bundle every
// `fibx` invocation loads and `npx fibx` downloads. A second entry would carry
// its own copy of that layer (measured at 340 KB for a stub that only imported
// `App`), so there is exactly one built document and exactly one ui:// URI.
export const APP_URI = "ui://fibx/app.html";

/** The one built document, as the host will receive it. Exported for tests. */
export const appHtml: string = documentHtml;

export function registerApp(server: McpServer): void {
	registerAppResource(
		server,
		APP_URI,
		APP_URI,
		{
			mimeType: RESOURCE_MIME_TYPE,
			// The pairing view copies the wc: URI. Declaring is necessary and not
			// sufficient — the app still feature-detects, and falls back to
			// execCommand("copy"), because a host may refuse.
			_meta: { ui: { permissions: { clipboardWrite: {} } } },
		},
		async () => ({
			contents: [{ uri: APP_URI, mimeType: RESOURCE_MIME_TYPE, text: appHtml }],
		})
	);
}
```

- [ ] **Step 7: Rewrite `src/mcp/ui.test.ts` for one resource**

```typescript
import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { APP_URI, appHtml, registerApp } from "./ui.js";

describe("the app resource", () => {
	it("uses the ui:// scheme the host looks for", () => {
		expect(APP_URI.startsWith("ui://")).toBe(true);
	});

	// The vitest html-as-text loader (vitest.config.ts) inlined the built
	// document rather than a path or an empty string. Until Task 6 rewrites
	// main.tsx the marker is the old panel's; Task 6 changes this assertion to
	// `data-fibx-app`.
	it("carries the built document, inlined", () => {
		expect(appHtml).toContain("data-fibx-panel");
		expect(appHtml).not.toMatch(/<script[^>]+src=/);
	});

	// Bytes, not UTF-16 code units: the constraint is download weight on every
	// `npx fibx`, and the two differ by ~18 KB on this document.
	it("stays under the size budget", () => {
		expect(Buffer.byteLength(appHtml, "utf8")).toBeLessThan(400_000);
	});

	it("declares clipboard write, the one permission the pairing view needs", () => {
		const server = new McpServer({ name: "t", version: "0" });
		registerApp(server);
		const registered = (
			server as unknown as {
				_registeredResources: Record<string, { metadata?: Record<string, unknown> }>;
			}
		)._registeredResources[APP_URI];
		expect(registered?.metadata?._meta).toEqual({
			ui: { permissions: { clipboardWrite: {} } },
		});
	});
});
```

- [ ] **Step 8: Unbind `get_quote` and `get_auth_status`**

In `src/mcp/tools/trade.ts`: change `registerAppTool(server, "get_quote", {...}, ...)` to `server.registerTool("get_quote", {...}, ...)`, delete the `_meta: { ui: { resourceUri: SWAP_CARD_URI } }` line, delete the `registerAppTool` and `SWAP_CARD_URI` imports, and append this sentence to the description string: ` In a host that renders UI, prefer open_fibx, which shows the route and lets the user swap from it.` Update the comment above the registration to say the tool is headless.

In `src/mcp/tools/auth.ts`: the same for `get_auth_status` — `server.registerTool`, no `_meta`, no `registerAppTool`/`WALLET_PANEL_URI` imports.

- [ ] **Step 9: Write the failing tool tests**

`src/mcp/tools/app.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./index.js";
import { APP_URI } from "../ui.js";

type Registered = Record<string, { annotations?: Record<string, unknown>; _meta?: unknown }>;

function registry(): Registered {
	const server = new McpServer({ name: "t", version: "0" });
	registerTools(server);
	return (server as unknown as { _registeredTools: Registered })._registeredTools;
}

describe("the app tools", () => {
	it("binds open_fibx to the app resource, read-only", () => {
		const t = registry().open_fibx;
		expect(t._meta).toEqual({ ui: { resourceUri: APP_URI } });
		expect(t.annotations?.readOnlyHint).toBe(true);
		expect(t.annotations?.destructiveHint).toBe(false);
	});

	it("registers list_tokens headless and read-only", () => {
		const t = registry().list_tokens;
		expect(t._meta).toBeUndefined();
		expect(t.annotations?.readOnlyHint).toBe(true);
	});

	// One tool, one app. Anything else bound to UI would produce a second
	// widget in the chat for the same turn.
	it("binds nothing else to a UI resource", () => {
		const bound = Object.entries(registry())
			.filter(([, t]) => t._meta !== undefined)
			.map(([name]) => name);
		expect(bound).toEqual(["open_fibx"]);
	});

	it("keeps swap_tokens destructive and unbound", () => {
		const t = registry().swap_tokens;
		expect(t._meta).toBeUndefined();
		expect(t.annotations?.readOnlyHint).toBe(false);
		expect(t.annotations?.destructiveHint).toBe(true);
	});
});
```

The `_registeredTools` accessor is the same private field `src/mcp/tools/trade.test.ts` already reads; if its name differs in the installed SDK, fix the accessor and keep the assertions.

- [ ] **Step 10: Run to verify it fails**

Run: `pnpm exec vitest run src/mcp/tools/app.test.ts`
Expected: FAIL — `registry().open_fibx` is undefined.

- [ ] **Step 11: Register the tools**

`src/mcp/tools/app.ts`:

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { handleOpenFibx, handleListTokens } from "../handlers/app.js";
import { withErrorHandling } from "./error-handling.js";
import { ChainEnum } from "./schemas.js";
import { APP_URI } from "../ui.js";
import { slippageSchema } from "../../lib/validation.js";

export function registerAppTools(server: McpServer): number {
	// The ONLY tool bound to a ui:// resource. It is read-only: opening the app
	// changes nothing; every write happens from a click inside it.
	registerAppTool(
		server,
		"open_fibx",
		{
			title: "Open FibX",
			description:
				"Open the FibX app: wallet, balances, signing policy, and a swap form with the Fibrous route. Call this for anything about the wallet, a balance, a quote, or a swap — the user sees the app and acts from it. Pass from/to/amount to open it pre-filled with a quote. Supported chains: Base, HyperEVM, Monad.",
			inputSchema: {
				chain: ChainEnum.default("base").describe("Chain to open on"),
				from: z.string().optional().describe("Source token symbol, to pre-fill a swap"),
				to: z.string().optional().describe("Destination token symbol, to pre-fill a swap"),
				amount: z
					.string()
					.optional()
					.describe("Amount of the source token, to pre-fill a swap"),
				slippage: slippageSchema
					.optional()
					.describe("Slippage percent for the pre-filled quote"),
			},
			annotations: {
				title: "FibX App",
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
			_meta: { ui: { resourceUri: APP_URI } },
		},
		withErrorHandling(handleOpenFibx)
	);

	// Headless: only the app's token picker calls this.
	server.registerTool(
		"list_tokens",
		{
			title: "List Tokens",
			description:
				"List the tokens Fibrous supports on a chain, with symbol, name, address, decimals and USD price where known.",
			inputSchema: {
				chain: ChainEnum.default("base").describe("Chain to list tokens for"),
			},
			annotations: {
				title: "Token List",
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		withErrorHandling(handleListTokens)
	);

	return 2;
}
```

In `src/mcp/tools/index.ts`, import `registerAppTools` and add `{ name: "App", count: registerAppTools(server) }` to `categories`.

In `src/mcp/server.ts`, replace the `registerWalletPanel`/`registerSwapCard` import and calls with `registerApp` and `registerApp(server)`.

- [ ] **Step 12: Run all the tests**

Run: `pnpm test`
Expected: PASS. Some earlier tests assert the old URIs or `_meta` on `get_quote` (`src/mcp/tools/trade.test.ts`, `src/mcp/tools/annotations.test.ts`) — update those assertions to the new truth (no `_meta` on `get_quote`; `open_fibx` is the bound tool). Do not delete a test to make it pass; change what it asserts and say why in the commit.

- [ ] **Step 13: Verify and commit**

```bash
pnpm typecheck && ./node_modules/.bin/eslint src/ && ./node_modules/.bin/prettier --check src/ ui/
```

```bash
git add -A && git commit -m "feat: open_fibx and list_tokens — one tool, one app resource"
```

---

### Task 2: The pure modules — machine, errors, tokens, ToolError

No DOM. Everything here is tested with plain vitest.

**Files:**

- Create: `ui/src/types.ts`, `ui/src/machine.ts`, `ui/src/machine.test.ts`, `ui/src/errors.ts`, `ui/src/errors.test.ts`, `ui/src/tokens.ts`, `ui/src/tokens.test.ts`
- Modify: `ui/src/rpc.ts`, `ui/src/rpc.test.ts`

**Interfaces:**

- Consumes: `QuoteResult`, `Quote`, `hasRoute` from `./quote.js`; `MAX_POLL_ATTEMPTS` from `./status.js`; `MAX_SLIPPAGE_PERCENT`, `checkSlippage` from `./quote.js`.
- Produces: everything below. Later tasks import these names exactly.

- [ ] **Step 1: The shared types**

`ui/src/types.ts` — the snapshot from Task 1 plus every tool result the widget reads, moved here from `panel.tsx` and `swap-card.tsx`:

```typescript
import type { QuoteResult } from "./quote.js";

export type SessionKind = "walletconnect" | "privy" | "private-key";

export type AuthStatus = {
	authenticated: boolean;
	walletAddress: string | null;
	sessionType: SessionKind | null;
	chain: string;
	requiresApprovalPerTransaction: boolean;
	fibrousStatus: string;
};

export type Policy = {
	maxValue?: Record<string, string>;
	allowedChains?: string[];
	allowedDestinations?: Record<string, string[]>;
	expiry?: string;
};

export type PolicyState =
	| { state: "active"; rules: Policy; path: string }
	| { state: "absent"; path: string; message: string }
	| { state: "unreadable"; path: string; message: string };

export type Terms = { from: string; to: string; amount: string; slippage: number };

/** What open_fibx returns. Mirrors src/mcp/handlers/app.ts exactly. */
export type Snapshot = {
	chain: string;
	auth: AuthStatus;
	balances: Record<string, string> | null;
	policy: PolicyState;
	terms: Terms | null;
	quote: QuoteResult | null;
	quoteError: string | null;
};

export type TokenInfo = {
	symbol: string;
	name: string;
	address: string;
	decimals: number;
	price?: string;
};

export type TokenList = { chain: string; tokens: TokenInfo[] };

export type Pairing = { uri: string; qrDataUri: string; pairingId: string };

export type SimulateResult = {
	success: true;
	mode: string;
	amountIn: string;
	amountOut?: string;
	tokenIn: string;
	tokenOut: string;
	chain: string;
	requiresApproval?: boolean;
	estimatedGas?: string;
};

export type BroadcastResult = {
	txHash: string;
	amountIn: string;
	amountOut: string;
	tokenIn: string;
	tokenOut: string;
	chain: string;
	explorer?: string;
};

export type TxStatusResult = {
	hash: string;
	status: "confirmed" | "reverted";
	blockNumber: string;
	explorer?: string;
};
```

`ui/src/status.ts` currently exports `Policy` and `SessionKind` too; leave them there for now (Task 9 removes the duplicates when the old components go) — but make `types.ts` the one the new code imports.

- [ ] **Step 2: Write the failing machine tests**

`ui/src/machine.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { canSwap, initialState, isLocked, transition, type State } from "./machine.js";
import type { QuoteResult } from "./quote.js";
import type { SimulateResult } from "./types.js";

const TERMS = { from: "ETH", to: "USDC", amount: "0.001", slippage: 0.5 };
const QUOTE = {
	input: "0.001 ETH",
	output: "~2.45 USDC",
	rate: "1 ETH ≈ 2450 USDC",
	chain: "base",
	slippage: "0.5%",
	router: "0xr",
	quote: {
		fromToken: "ETH",
		toToken: "USDC",
		inputAmount: "0.001",
		outputAmount: "2.45",
		minReceived: "2.43",
		slippage: 0.5,
		usdIn: 2.45,
		usdOut: 2.45,
		priceImpact: 0.02,
		route: [],
		routerAddress: "0xr",
		chain: "base",
	},
} satisfies QuoteResult;
const SIM: SimulateResult = {
	success: true,
	mode: "SIMULATION (no TX sent)",
	amountIn: "0.001",
	amountOut: "2.45",
	tokenIn: "ETH",
	tokenOut: "USDC",
	chain: "base",
	requiresApproval: false,
};
const TX = { txHash: "0xabc", explorer: "https://x/tx/0xabc" };

function quoted(): State {
	return transition(initialState(TERMS), { type: "QUOTE_ARRIVED", quote: QUOTE });
}
function simulated(): State {
	return transition(transition(quoted(), { type: "SIMULATE" }), { type: "SIMULATED", sim: SIM });
}
function broadcast(): State {
	return transition(transition(simulated(), { type: "SWAP" }), {
		type: "BROADCAST",
		...TX,
		amounts: { amountIn: "0.001", amountOut: "2.45", tokenIn: "ETH", tokenOut: "USDC" },
	});
}

describe("the happy path", () => {
	it("starts editing with the given terms and no quote", () => {
		const s = initialState(TERMS);
		expect(s.kind).toBe("editing");
		expect(s.terms).toEqual(TERMS);
		expect(canSwap(s)).toBe(false);
	});

	it("becomes quoted when a quote arrives", () => {
		expect(quoted().kind).toBe("quoted");
	});

	// Swap is gated on a simulate that succeeded for exactly these terms: the
	// two-transactions disclosure lives only in the simulate result.
	it("unlocks Swap only after a successful simulate", () => {
		expect(canSwap(quoted())).toBe(false);
		expect(canSwap(simulated())).toBe(true);
	});

	it("reaches confirmed on a confirmed receipt", () => {
		const s = transition(broadcast(), {
			type: "RECEIPT",
			status: "confirmed",
			blockNumber: "1",
		});
		expect(s.kind).toBe("confirmed");
	});
});

describe("invalidation", () => {
	it("any change to the terms after a simulate returns to editing and locks Swap", () => {
		const s = transition(simulated(), {
			type: "TERMS_CHANGED",
			terms: { ...TERMS, amount: "1" },
		});
		expect(s.kind).toBe("editing");
		expect(canSwap(s)).toBe(false);
	});

	it("a new quote after a simulate returns to quoted, not simulated", () => {
		const s = transition(simulated(), { type: "QUOTE_ARRIVED", quote: QUOTE });
		expect(s.kind).toBe("quoted");
		expect(canSwap(s)).toBe(false);
	});
});

describe("locking", () => {
	// A hash exists and never resolved. Nothing may leave this state: a
	// re-quote or a second simulate would silently re-arm Swap on a transaction
	// that may already be in flight.
	it("unknown is terminal — ignores every event", () => {
		const unknown = transition(broadcast(), { type: "POLL_EXPIRED" });
		expect(unknown.kind).toBe("unknown");
		expect(isLocked(unknown)).toBe(true);
		for (const ev of [
			{ type: "TERMS_CHANGED", terms: TERMS },
			{ type: "QUOTE_ARRIVED", quote: QUOTE },
			{ type: "SIMULATE" },
			{ type: "SWAP" },
		] as const) {
			expect(transition(unknown, ev)).toBe(unknown);
		}
	});

	it("locks while simulating, swapping and broadcast", () => {
		expect(isLocked(transition(quoted(), { type: "SIMULATE" }))).toBe(true);
		expect(isLocked(transition(simulated(), { type: "SWAP" }))).toBe(true);
		expect(isLocked(broadcast())).toBe(true);
	});

	it("a terms change while locked is ignored", () => {
		const b = broadcast();
		expect(transition(b, { type: "TERMS_CHANGED", terms: { ...TERMS, amount: "9" } })).toBe(b);
	});

	// Confirmed and reverted are done. Editing again starts a new swap and is
	// allowed; the old hash is simply gone from the state.
	it("confirmed and reverted unlock on a terms change", () => {
		const confirmed = transition(broadcast(), {
			type: "RECEIPT",
			status: "confirmed",
			blockNumber: "1",
		});
		const next = transition(confirmed, { type: "TERMS_CHANGED", terms: TERMS });
		expect(next.kind).toBe("editing");
	});
});

describe("failure", () => {
	it("a simulate failure is not after a swap attempt", () => {
		const s = transition(transition(quoted(), { type: "SIMULATE" }), {
			type: "SIMULATE_FAILED",
			message: "insufficient",
		});
		expect(s.kind).toBe("failed");
		expect(s.kind === "failed" && s.afterSwapAttempt).toBe(false);
	});

	// The approval leg may already be on chain when the swap leg throws.
	it("a swap failure is after a swap attempt", () => {
		const s = transition(transition(simulated(), { type: "SWAP" }), {
			type: "SWAP_FAILED",
			message: "rejected",
		});
		expect(s.kind === "failed" && s.afterSwapAttempt).toBe(true);
	});

	it("failed keeps the quote so the form still draws", () => {
		const s = transition(transition(quoted(), { type: "SIMULATE" }), {
			type: "SIMULATE_FAILED",
			message: "x",
		});
		expect(s.kind === "failed" && s.quote).toEqual(QUOTE);
	});
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm exec vitest run ui/src/machine.test.ts`
Expected: FAIL — `./machine.js` does not exist.

- [ ] **Step 4: Write the machine**

`ui/src/machine.ts`:

```typescript
import type { QuoteResult } from "./quote.js";
import type { SimulateResult, Terms } from "./types.js";

export type Amounts = { amountIn: string; amountOut: string; tokenIn: string; tokenOut: string };

export type State =
	| { kind: "editing"; terms: Terms; quote: QuoteResult | null }
	| { kind: "quoted"; terms: Terms; quote: QuoteResult }
	| { kind: "simulating"; terms: Terms; quote: QuoteResult }
	| { kind: "simulated"; terms: Terms; quote: QuoteResult; sim: SimulateResult }
	| { kind: "swapping"; terms: Terms; quote: QuoteResult; sim: SimulateResult }
	| { kind: "broadcast"; terms: Terms; txHash: string; explorer?: string; amounts: Amounts }
	| {
			kind: "confirmed";
			terms: Terms;
			txHash: string;
			explorer?: string;
			amounts: Amounts;
			blockNumber: string;
	  }
	| { kind: "reverted"; terms: Terms; txHash: string; explorer?: string; amounts: Amounts }
	// A hash exists and never resolved. Terminal: see isLocked.
	| { kind: "unknown"; terms: Terms; txHash: string; explorer?: string; amounts: Amounts }
	// No hash came back. `afterSwapAttempt` marks that an ERC-20 approval may
	// nonetheless be on chain: handleSwapTokens sends it before the swap.
	| {
			kind: "failed";
			terms: Terms;
			quote: QuoteResult | null;
			message: string;
			afterSwapAttempt: boolean;
	  };

export type Event =
	| { type: "TERMS_CHANGED"; terms: Terms }
	| { type: "QUOTE_ARRIVED"; quote: QuoteResult }
	| { type: "QUOTE_FAILED"; message: string }
	| { type: "SIMULATE" }
	| { type: "SIMULATED"; sim: SimulateResult }
	| { type: "SIMULATE_FAILED"; message: string }
	| { type: "SWAP" }
	| { type: "BROADCAST"; txHash: string; explorer?: string; amounts: Amounts }
	| { type: "SWAP_FAILED"; message: string }
	| { type: "RECEIPT"; status: "confirmed" | "reverted"; blockNumber: string; explorer?: string }
	| { type: "POLL_EXPIRED" };

export function initialState(terms: Terms, quote: QuoteResult | null = null): State {
	return quote ? { kind: "quoted", terms, quote } : { kind: "editing", terms, quote: null };
}

/**
 * Nothing the user does may change the state: a call is in flight, or a hash
 * exists whose outcome is not known. `unknown` stays locked forever — there is
 * no safe retry for a transaction that may already be in flight, and a
 * re-quote or a second simulate would silently re-arm Swap.
 */
export function isLocked(s: State): boolean {
	return (
		s.kind === "simulating" ||
		s.kind === "swapping" ||
		s.kind === "broadcast" ||
		s.kind === "unknown"
	);
}

/** Swap is allowed only on a simulate that succeeded for the current terms. */
export function canSwap(s: State): boolean {
	return s.kind === "simulated";
}

function quoteOf(s: State): QuoteResult | null {
	return "quote" in s ? s.quote : null;
}

/**
 * Pure. Returns the SAME object when an event does not apply, so a caller (and
 * a test) can tell "ignored" from "re-entered the same kind".
 */
export function transition(s: State, ev: Event): State {
	if (isLocked(s)) {
		// Only the events that end the in-flight operation apply.
		switch (s.kind) {
			case "simulating":
				if (ev.type === "SIMULATED")
					return { kind: "simulated", terms: s.terms, quote: s.quote, sim: ev.sim };
				if (ev.type === "SIMULATE_FAILED")
					return {
						kind: "failed",
						terms: s.terms,
						quote: s.quote,
						message: ev.message,
						afterSwapAttempt: false,
					};
				return s;
			case "swapping":
				if (ev.type === "BROADCAST")
					return {
						kind: "broadcast",
						terms: s.terms,
						txHash: ev.txHash,
						explorer: ev.explorer,
						amounts: ev.amounts,
					};
				if (ev.type === "SWAP_FAILED")
					return {
						kind: "failed",
						terms: s.terms,
						quote: s.quote,
						message: ev.message,
						afterSwapAttempt: true,
					};
				return s;
			case "broadcast":
				if (ev.type === "RECEIPT") {
					const base = {
						terms: s.terms,
						txHash: s.txHash,
						explorer: ev.explorer ?? s.explorer,
						amounts: s.amounts,
					};
					return ev.status === "confirmed"
						? { kind: "confirmed", ...base, blockNumber: ev.blockNumber }
						: { kind: "reverted", ...base };
				}
				if (ev.type === "POLL_EXPIRED")
					return {
						kind: "unknown",
						terms: s.terms,
						txHash: s.txHash,
						explorer: s.explorer,
						amounts: s.amounts,
					};
				return s;
			case "unknown":
				return s;
		}
	}

	switch (ev.type) {
		case "TERMS_CHANGED":
			return { kind: "editing", terms: ev.terms, quote: null };
		case "QUOTE_ARRIVED":
			return { kind: "quoted", terms: s.terms, quote: ev.quote };
		case "QUOTE_FAILED":
			return {
				kind: "failed",
				terms: s.terms,
				quote: null,
				message: ev.message,
				afterSwapAttempt: false,
			};
		case "SIMULATE": {
			const quote = quoteOf(s);
			if (!quote) return s;
			return { kind: "simulating", terms: s.terms, quote };
		}
		case "SWAP":
			if (s.kind !== "simulated") return s;
			return { kind: "swapping", terms: s.terms, quote: s.quote, sim: s.sim };
		default:
			return s;
	}
}
```

Prettier will re-wrap the long return lines; let it.

- [ ] **Step 5: Run the machine tests**

Run: `pnpm exec vitest run ui/src/machine.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: `ToolError` in `rpc.ts`**

`callJson` currently throws a bare `Error` and drops the failure body's `code` and `details`. `explainError` keys on the code (a policy refusal is `POLICY_BLOCKED`), so the code must survive.

Replace the body of `ui/src/rpc.ts`:

```typescript
import type { App } from "@modelcontextprotocol/ext-apps";
import { parseToolJson } from "./status.js";

type FailureBody = {
	success?: boolean;
	error?: string;
	message?: string;
	rawMessage?: string;
	code?: string;
	details?: unknown;
};

/**
 * A tool call that failed, with what withErrorHandling
 * (src/mcp/tools/error-handling.ts) put in the body: the parsed message, the
 * FibxError code where there was one, and the raw message for the disclosure.
 */
export class ToolError extends Error {
	constructor(
		message: string,
		public readonly code: string | undefined,
		public readonly raw: string | undefined,
		public readonly details: unknown
	) {
		super(message);
		this.name = "ToolError";
	}
}

/**
 * Call a server tool and decode its JSON.
 *
 * This server's tools report failure two different ways, and both have to be
 * caught here or a caller sees a broken success value instead of an error:
 *
 * - `isError: true` — the SDK sets this only when a handler throws past its
 *   own catch, which in practice is essentially just zod input-validation.
 * - a normal (non-error) result whose JSON body is `{ success: false, error,
 *   code, rawMessage }` — withErrorHandling catches every thrown error and
 *   returns this shape with no `isError` at all. This is how most tool
 *   failures actually arrive.
 */
export async function callJson<T>(
	app: App,
	name: string,
	args: Record<string, unknown> = {}
): Promise<T> {
	const result = await app.callServerTool({ name, arguments: args });
	if (result.isError) {
		let body: FailureBody = {};
		try {
			body = parseToolJson<FailureBody>(result);
		} catch {
			const text = result.content?.find((c) => c.type === "text")?.text;
			body = { message: text };
		}
		throw new ToolError(
			body.error ?? body.message ?? "Tool call failed",
			body.code,
			body.rawMessage,
			body.details
		);
	}
	const body = parseToolJson<FailureBody>(result);
	if (body.success === false) {
		throw new ToolError(
			body.error ?? body.message ?? body.rawMessage ?? "Tool call failed",
			body.code,
			body.rawMessage,
			body.details
		);
	}
	return body as T;
}
```

Add to `ui/src/rpc.test.ts`:

```typescript
it("preserves the failure code and raw message on a ToolError", async () => {
	const app = {
		callServerTool: async () => ({
			content: [
				{
					type: "text",
					text: JSON.stringify({
						success: false,
						error: "Blocked by policy",
						code: "POLICY_BLOCKED",
						rawMessage: "raw",
						details: { rule: "base.maxValue" },
					}),
				},
			],
		}),
	} as never;
	await expect(callJson(app, "swap_tokens")).rejects.toMatchObject({
		name: "ToolError",
		message: "Blocked by policy",
		code: "POLICY_BLOCKED",
		raw: "raw",
		details: { rule: "base.maxValue" },
	});
});
```

Run: `pnpm exec vitest run ui/src/rpc.test.ts` — all pass.

- [ ] **Step 7: Write the failing `explainError` tests**

`ui/src/errors.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { explainError } from "./errors.js";
import { ToolError } from "./rpc.js";

const ctx = { symbol: "ETH", amount: "0.0005", balance: "0.0002" };

describe("explainError", () => {
	// The one the first real use hit: an eth_estimateGas dump in red.
	it("names an insufficient balance from the amounts, not the RPC body", () => {
		const e = new Error(
			'Transaction creation failed. URL: https://mainnet.base.org Request body: {"method":"eth_estimateGas","params":[...]}'
		);
		const x = explainError(e, ctx);
		expect(x.title).toBe("Insufficient balance");
		expect(x.detail).toBe("You have 0.0002 ETH; this needs 0.0005.");
		expect(x.severity).toBe("error");
	});

	it("names a policy refusal and points at the section", () => {
		const e = new ToolError("Blocked by signing policy: base.maxValue", "POLICY_BLOCKED", "x", {
			rule: "base.maxValue",
		});
		const x = explainError(e, {});
		expect(x.title).toBe("Blocked by your signing policy");
		expect(x.detail).toContain("base.maxValue");
		expect(x.action).toBe("policy");
	});

	it("names a wallet rejection and says nothing was sent", () => {
		const x = explainError(
			new Error("UserRejectedRequestError: User rejected the request"),
			{}
		);
		expect(x.title).toBe("Rejected in your wallet");
		expect(x.detail).toBe("Nothing was sent.");
	});

	it("names a moved price", () => {
		const x = explainError(new Error("execution reverted: INSUFFICIENT_OUTPUT_AMOUNT"), {});
		expect(x.title).toBe("The price moved");
		expect(x.action).toBe("requote");
	});

	it("names an unknown token from the code", () => {
		const e = new ToolError(
			"Token not found: XYZ",
			"TOKEN_NOT_SUPPORTED",
			undefined,
			undefined
		);
		const x = explainError(e, { symbol: "XYZ" });
		expect(x.title).toBe('"XYZ" is not on this chain');
		expect(x.action).toBe("pick");
	});

	// Anything unmapped: a short first line, and the raw text kept for the
	// disclosure — never lost, never the headline.
	it("keeps the raw text in detail for an unknown error", () => {
		const raw = "Something odd happened\nwith many lines";
		const x = explainError(new Error(raw), {});
		expect(x.title).toBe("Something odd happened");
		expect(x.raw).toBe(raw);
	});

	it("does not call it a balance problem when the amount fits the balance", () => {
		const x = explainError(new Error("eth_estimateGas failed"), {
			symbol: "ETH",
			amount: "0.0001",
			balance: "0.0002",
		});
		expect(x.title).not.toBe("Insufficient balance");
	});
});
```

- [ ] **Step 8: Run to verify it fails**

Run: `pnpm exec vitest run ui/src/errors.test.ts`
Expected: FAIL — `./errors.js` does not exist.

- [ ] **Step 9: Write `explainError`**

`ui/src/errors.ts`:

```typescript
import { ToolError } from "./rpc.js";

export type Explained = {
	title: string;
	detail?: string;
	/** The unmapped text, for a disclosure. Present only when nothing matched. */
	raw?: string;
	severity: "error" | "warning";
	/** Something the UI can offer: open the policy section, re-quote, open the picker. */
	action?: "policy" | "requote" | "pick";
};

export type ErrorContext = {
	symbol?: string;
	amount?: string;
	balance?: string;
};

function exceedsBalance(ctx: ErrorContext): boolean {
	if (ctx.amount === undefined || ctx.balance === undefined) return false;
	const a = Number(ctx.amount);
	const b = Number(ctx.balance);
	return Number.isFinite(a) && Number.isFinite(b) && a > b;
}

/**
 * A raw message never reaches the user. Known signatures become a sentence, a
 * severity and — where one exists — an action; anything else keeps its first
 * line as the headline and the whole text behind a disclosure.
 */
export function explainError(err: unknown, ctx: ErrorContext): Explained {
	const message = err instanceof Error ? err.message : String(err);
	const code = err instanceof ToolError ? err.code : undefined;
	const details = err instanceof ToolError ? err.details : undefined;

	if (code === "POLICY_BLOCKED") {
		const rule =
			details && typeof details === "object" && "rule" in details
				? String((details as { rule: unknown }).rule)
				: undefined;
		return {
			title: "Blocked by your signing policy",
			detail: rule
				? `The rule ${rule} refused it. Edit it below.`
				: `${message} Edit it below.`,
			severity: "error",
			action: "policy",
		};
	}

	if (code === "TOKEN_NOT_SUPPORTED" || /token not found|unknown token/i.test(message)) {
		return {
			title: `"${ctx.symbol ?? "That token"}" is not on this chain`,
			detail: "Pick one from the list.",
			severity: "error",
			action: "pick",
		};
	}

	if (/UserRejectedRequestError|user rejected|rejected the request/i.test(message)) {
		return {
			title: "Rejected in your wallet",
			detail: "Nothing was sent.",
			severity: "warning",
		};
	}

	if (/INSUFFICIENT_OUTPUT_AMOUNT|slippage|price moved/i.test(message)) {
		return {
			title: "The price moved",
			detail: "Refresh the quote, or raise slippage.",
			severity: "warning",
			action: "requote",
		};
	}

	// An estimateGas revert with an amount over the balance is the balance —
	// the RPC body says nothing useful, so it is not shown.
	if (
		exceedsBalance(ctx) ||
		/insufficient funds|transfer amount exceeds balance|InsufficientFundsError/i.test(message)
	) {
		const detail =
			ctx.symbol && ctx.amount && ctx.balance
				? `You have ${ctx.balance} ${ctx.symbol}; this needs ${ctx.amount}.`
				: "Not enough of the token, or not enough for gas.";
		return { title: "Insufficient balance", detail, severity: "error" };
	}

	const firstLine = message.split("\n")[0].trim();
	return {
		title: firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine,
		raw: message,
		severity: "error",
	};
}
```

- [ ] **Step 10: Run the error tests**

Run: `pnpm exec vitest run ui/src/errors.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 11: Write the failing token helper tests**

`ui/src/tokens.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { filterTokens, orderTokens } from "./tokens.js";
import type { TokenInfo } from "./types.js";

const t = (symbol: string, name = symbol): TokenInfo => ({
	symbol,
	name,
	address: `0x${symbol}`,
	decimals: 18,
});
const LIST = [
	t("ZRO", "LayerZero"),
	t("USDC", "USD Coin"),
	t("ETH", "Ether"),
	t("AERO", "Aerodrome"),
];

describe("orderTokens", () => {
	// Popular first, in the pinned order; the rest alphabetically. A pinned
	// symbol absent from the list is simply skipped — the constant is a wish
	// list, not a claim about what Fibrous serves.
	it("pins the chain's popular tokens ahead of the alphabetical rest", () => {
		expect(orderTokens(LIST, "base").map((x) => x.symbol)).toEqual([
			"ETH",
			"USDC",
			"AERO",
			"ZRO",
		]);
	});

	it("falls back to alphabetical on a chain with no pins", () => {
		expect(orderTokens(LIST, "nowhere").map((x) => x.symbol)).toEqual([
			"AERO",
			"ETH",
			"USDC",
			"ZRO",
		]);
	});
});

describe("filterTokens", () => {
	it("matches symbol and name, case-insensitively", () => {
		expect(filterTokens(LIST, "usd").map((x) => x.symbol)).toEqual(["USDC"]);
		expect(filterTokens(LIST, "layer").map((x) => x.symbol)).toEqual(["ZRO"]);
	});

	it("returns everything for an empty query", () => {
		expect(filterTokens(LIST, "  ")).toHaveLength(4);
	});

	it("ranks a symbol prefix above a name match", () => {
		const list = [t("AERO", "Aerodrome"), t("XAE", "aero-ish")];
		expect(filterTokens(list, "ae").map((x) => x.symbol)).toEqual(["AERO", "XAE"]);
	});
});
```

- [ ] **Step 12: Run to verify it fails**

Run: `pnpm exec vitest run ui/src/tokens.test.ts`
Expected: FAIL — `./tokens.js` does not exist.

- [ ] **Step 13: Write the token helpers**

`ui/src/tokens.ts`:

```typescript
import type { TokenInfo } from "./types.js";

/**
 * Pinned at the top of the picker, per chain. A wish list: a symbol Fibrous
 * does not serve on that chain is skipped, not invented.
 */
export const POPULAR: Record<string, readonly string[]> = {
	base: ["ETH", "WETH", "USDC", "cbBTC", "DAI", "USDbC"],
	hyperevm: ["HYPE", "WHYPE", "USDC", "USDT", "UBTC", "UETH"],
	monad: ["MON", "WMON", "USDC", "USDT", "WETH", "WBTC"],
};

export function orderTokens(list: readonly TokenInfo[], chain: string): TokenInfo[] {
	const pins = POPULAR[chain] ?? [];
	const bySymbol = new Map(list.map((t) => [t.symbol.toUpperCase(), t]));
	const pinned = pins
		.map((s) => bySymbol.get(s.toUpperCase()))
		.filter((t): t is TokenInfo => t !== undefined);
	const pinnedSet = new Set(pinned.map((t) => t.symbol.toUpperCase()));
	const rest = list
		.filter((t) => !pinnedSet.has(t.symbol.toUpperCase()))
		.sort((a, b) => a.symbol.localeCompare(b.symbol));
	return [...pinned, ...rest];
}

/** Client-side; a few hundred tokens is not a search problem. */
export function filterTokens(list: readonly TokenInfo[], query: string): TokenInfo[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...list];
	const score = (t: TokenInfo): number => {
		const s = t.symbol.toLowerCase();
		const n = t.name.toLowerCase();
		if (s === q) return 0;
		if (s.startsWith(q)) return 1;
		if (n.startsWith(q)) return 2;
		if (s.includes(q) || n.includes(q)) return 3;
		return -1;
	};
	return list
		.map((t) => ({ t, k: score(t) }))
		.filter((x) => x.k >= 0)
		.sort((a, b) => a.k - b.k || a.t.symbol.localeCompare(b.t.symbol))
		.map((x) => x.t);
}
```

- [ ] **Step 14: Run the token tests**

Run: `pnpm exec vitest run ui/src/tokens.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 15: Verify and commit**

```bash
pnpm test && pnpm typecheck && ./node_modules/.bin/prettier --check src/ ui/
```

```bash
git add -A && git commit -m "feat: the widget's pure core — state machine, error language, token helpers"
```

---

### Task 3: A DOM for tests, and the token picker

**Files:**

- Create: `ui/src/test-utils.ts`, `ui/src/picker.tsx`, `ui/src/picker.test.tsx`
- Modify: `package.json`, `vitest.config.ts`

**Interfaces:**

- Consumes: `TokenInfo`, `TokenList` from `./types.js`; `filterTokens`, `orderTokens` from `./tokens.js`; `callJson` from `./rpc.js`; `explainError` from `./errors.js`.
- Produces: `mount(vnode)` from `./test-utils.js`; `<TokenPicker app chain onPick onClose exclude? />` from `./picker.js`.

- [ ] **Step 1: Add `happy-dom`**

```bash
pnpm add -D happy-dom
```

Then open `package.json` and confirm it landed under `devDependencies` and that no `dependencies` key appeared. Pin the exact version the install chose (replace `^x.y.z` with `x.y.z`) — this is the first DOM test environment in `ui/` and a silent major bump would be a surprise.

- [ ] **Step 2: Teach vitest about `.tsx` tests and preact JSX**

In `vitest.config.ts`, change `include` to `["src/**/*.test.ts", "ui/src/**/*.test.{ts,tsx}"]` and add, at the top level of the config object:

```typescript
	esbuild: { jsx: "automatic", jsxImportSource: "preact" },
```

The environment stays `"node"` globally. Component tests opt in per file with a docblock:

```typescript
// @vitest-environment happy-dom
```

That is the whole configuration — no projects, no globs.

- [ ] **Step 3: The mount helper**

`ui/src/test-utils.ts`:

```typescript
import { render, type ComponentChild } from "preact";

/**
 * Mount a vnode into a detached container under happy-dom and hand back the
 * few things a component test needs. No testing library: a query selector
 * and a dispatched event are enough to prove a button locks or a control
 * turns into its explanation.
 */
export function mount(vnode: ComponentChild) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	render(vnode, container);

	const q = <T extends Element = HTMLElement>(selector: string): T => {
		const el = container.querySelector<T>(selector);
		if (!el) throw new Error(`no element matches ${selector}`);
		return el;
	};

	return {
		container,
		q,
		text: () => container.textContent ?? "",
		click(selector: string) {
			q<HTMLElement>(selector).click();
		},
		type(selector: string, value: string) {
			const el = q<HTMLInputElement>(selector);
			el.value = value;
			el.dispatchEvent(new Event("input", { bubbles: true }));
		},
		async flush() {
			// Let effects and resolved promises settle.
			await new Promise((r) => setTimeout(r, 0));
			await new Promise((r) => setTimeout(r, 0));
		},
		unmount() {
			render(null, container);
			container.remove();
		},
	};
}

/** A fake `App` whose callServerTool answers from a table, and records calls. */
export function fakeApp(
	answers: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>
) {
	const calls: { name: string; args: Record<string, unknown> }[] = [];
	const app = {
		calls,
		async callServerTool({
			name,
			arguments: args = {},
		}: {
			name: string;
			arguments?: Record<string, unknown>;
		}) {
			calls.push({ name, args });
			const a = answers[name];
			if (a === undefined) throw new Error(`fakeApp: no answer for ${name}`);
			const body =
				typeof a === "function" ? (a as (x: Record<string, unknown>) => unknown)(args) : a;
			if (body instanceof Error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ success: false, error: body.message }),
						},
					],
				};
			}
			return { content: [{ type: "text", text: JSON.stringify(body) }] };
		},
		async updateModelContext() {
			return {};
		},
		async openLink() {
			return {};
		},
		getHostContext() {
			return undefined;
		},
	};
	return app as unknown as import("@modelcontextprotocol/ext-apps").App & { calls: typeof calls };
}
```

- [ ] **Step 4: Write the failing picker test**

`ui/src/picker.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { TokenPicker } from "./picker.js";
import { fakeApp, mount } from "./test-utils.js";

const TOKENS = {
	chain: "base",
	tokens: [
		{ symbol: "ZRO", name: "LayerZero", address: "0x1", decimals: 18 },
		{ symbol: "USDC", name: "USD Coin", address: "0x2", decimals: 6 },
		{ symbol: "ETH", name: "Ether", address: "0x3", decimals: 18 },
	],
};

describe("TokenPicker", () => {
	it("lists the chain's tokens, popular first, after list_tokens answers", async () => {
		const app = fakeApp({ list_tokens: TOKENS });
		const m = mount(
			<TokenPicker app={app} chain="base" onPick={() => {}} onClose={() => {}} />
		);
		await m.flush();
		const symbols = [...m.container.querySelectorAll("[data-token]")].map((el) =>
			el.getAttribute("data-token")
		);
		expect(symbols).toEqual(["ETH", "USDC", "ZRO"]);
		expect(app.calls[0]).toEqual({ name: "list_tokens", args: { chain: "base" } });
		m.unmount();
	});

	it("filters as the user types", async () => {
		const m = mount(
			<TokenPicker
				app={fakeApp({ list_tokens: TOKENS })}
				chain="base"
				onPick={() => {}}
				onClose={() => {}}
			/>
		);
		await m.flush();
		m.type("input[type=search]", "layer");
		await m.flush();
		expect(m.container.querySelectorAll("[data-token]")).toHaveLength(1);
		expect(m.q("[data-token]").getAttribute("data-token")).toBe("ZRO");
		m.unmount();
	});

	it("reports the picked token and does not list the excluded one", async () => {
		const onPick = vi.fn();
		const m = mount(
			<TokenPicker
				app={fakeApp({ list_tokens: TOKENS })}
				chain="base"
				exclude="ETH"
				onPick={onPick}
				onClose={() => {}}
			/>
		);
		await m.flush();
		expect(m.container.querySelector('[data-token="ETH"]')).toBeNull();
		m.click('[data-token="USDC"]');
		expect(onPick).toHaveBeenCalledWith(TOKENS.tokens[1]);
		m.unmount();
	});

	// The list failing is a message in the picker, not a crash of the app.
	it("explains a failed list instead of an empty box", async () => {
		const m = mount(
			<TokenPicker
				app={fakeApp({ list_tokens: new Error("Network error") })}
				chain="base"
				onPick={() => {}}
				onClose={() => {}}
			/>
		);
		await m.flush();
		expect(m.text()).toContain("Network error");
		m.unmount();
	});
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm exec vitest run ui/src/picker.test.tsx`
Expected: FAIL — `./picker.js` does not exist. (If the failure is instead about JSX or the environment, Step 2 is incomplete — fix that first.)

- [ ] **Step 6: Write the picker**

`ui/src/picker.tsx`:

```tsx
import { useEffect, useRef, useState } from "preact/hooks";
import type { App } from "@modelcontextprotocol/ext-apps";
import { callJson } from "./rpc.js";
import { explainError } from "./errors.js";
import { filterTokens, orderTokens } from "./tokens.js";
import type { TokenInfo, TokenList } from "./types.js";

// One fetch per chain for the widget's life; the list does not change while a
// card is open, and the picker opens more than once.
const cache = new Map<string, TokenInfo[]>();

export function TokenPicker({
	app,
	chain,
	exclude,
	onPick,
	onClose,
}: {
	app: App;
	chain: string;
	exclude?: string;
	onPick: (t: TokenInfo) => void;
	onClose: () => void;
}) {
	const [all, setAll] = useState<TokenInfo[] | null>(cache.get(chain) ?? null);
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string | null>(null);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	useEffect(() => {
		if (cache.has(chain)) {
			setAll(cache.get(chain)!);
			return;
		}
		callJson<TokenList>(app, "list_tokens", { chain })
			.then((r) => {
				if (!alive.current) return;
				const ordered = orderTokens(r.tokens, chain);
				cache.set(chain, ordered);
				setAll(ordered);
			})
			.catch((e) => {
				if (!alive.current) return;
				setError(explainError(e, {}).title);
			});
	}, [app, chain]);

	const shown = all
		? filterTokens(all, query).filter((t) => t.symbol.toUpperCase() !== exclude?.toUpperCase())
		: [];

	return (
		<div class="picker" role="dialog" aria-label="Choose a token">
			<div class="row">
				<input
					type="search"
					class="mono"
					placeholder="Search by symbol or name"
					value={query}
					onInput={(e) => setQuery(e.currentTarget.value)}
					autoFocus
				/>
				<button class="ghost" onClick={onClose} aria-label="Close">
					×
				</button>
			</div>
			{error && <p class="error">{error}</p>}
			{!all && !error && <p class="muted">loading tokens…</p>}
			{all && shown.length === 0 && <p class="muted">No token matches "{query}".</p>}
			<ul class="token-list">
				{shown.map((t) => (
					<li key={t.address}>
						<button class="token-row" data-token={t.symbol} onClick={() => onPick(t)}>
							<span class="mono">{t.symbol}</span>
							<span class="muted">{t.name}</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
```

Add to `ui/src/tokens.css`:

```css
.picker {
	display: flex;
	flex-direction: column;
	gap: 8px;
	max-height: 360px;
}

.token-list {
	list-style: none;
	margin: 0;
	padding: 0;
	overflow-y: auto;
}

.token-row {
	width: 100%;
	display: flex;
	justify-content: space-between;
	background: transparent;
	color: rgb(var(--text-primary));
	text-align: left;
}

.token-row:hover {
	background: rgb(var(--bg-tertiary));
}
```

- [ ] **Step 7: Run the picker tests**

Run: `pnpm exec vitest run ui/src/picker.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 8: Verify and commit**

```bash
pnpm test && pnpm typecheck && ./node_modules/.bin/prettier --check src/ ui/
```

`pnpm typecheck` runs `tsc -p ui/tsconfig.json`, which has `types: []`; `document` and `navigator` in test files compile because `lib` defaults to include DOM. The tests import `describe`/`it`/`vi` explicitly from `vitest`, so no `types` entry is needed — if those names fail to resolve, the import line is wrong, not the config.

```bash
git add -A && git commit -m "feat: a DOM for component tests, and the token picker"
```

---

### Task 4: The pairing view — controls that explain themselves

`Disconnected` in `panel.tsx` retired its Copy and _Open in your wallet_ buttons on refusal. Both vanished in Claude Desktop. This task rebuilds it as `Pairing`: same flow, and a control that cannot work becomes a sentence in place.

**Files:**

- Create: `ui/src/pairing.tsx`, `ui/src/pairing.test.tsx`

**Interfaces:**

- Consumes: `callJson`, `explainError`, `nextPoll` + `ConnectStatus` from `./status.js`, `Pairing` type from `./types.js`.
- Produces: `<Pairing app onConnected onCancel />`; `copyText(text): Promise<"clipboard" | "execCommand" | "unavailable">` exported for the test.

- [ ] **Step 1: Write the failing tests**

`ui/src/pairing.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, Pairing } from "./pairing.js";
import { fakeApp, mount } from "./test-utils.js";

const PAIRING = {
	uri: "wc:abc@2?relay-protocol=irn&symKey=1",
	qrDataUri: "data:image/png;base64,x",
	pairingId: "p1",
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("copyText", () => {
	it("uses the async clipboard when the host allows it", async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		expect(await copyText("wc:x")).toBe("clipboard");
		expect(writeText).toHaveBeenCalledWith("wc:x");
	});

	// The legacy path usually survives a sandbox that blocks the modern one.
	it("falls back to execCommand when the clipboard rejects", async () => {
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: async () => Promise.reject(new Error("denied")) },
			configurable: true,
		});
		document.execCommand = vi.fn(() => true);
		expect(await copyText("wc:x")).toBe("execCommand");
	});

	it("reports unavailable when both paths fail", async () => {
		Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
		document.execCommand = vi.fn(() => false);
		expect(await copyText("wc:x")).toBe("unavailable");
	});
});

describe("Pairing", () => {
	it("opens a pairing on Connect and shows the QR and the URI", async () => {
		const app = fakeApp({ connect_wallet: PAIRING, get_connect_status: { status: "pending" } });
		const m = mount(<Pairing app={app} onConnected={async () => {}} onCancel={() => {}} />);
		m.click("button[data-action=connect]");
		await m.flush();
		expect(m.q("img.qr").getAttribute("src")).toBe(PAIRING.qrDataUri);
		expect((m.q("textarea.uri") as HTMLTextAreaElement).value).toBe(PAIRING.uri);
		m.unmount();
	});

	// The bug this replaces: the button disappeared and the user read it as
	// broken. Now the control turns into the reason, in the same place.
	it("turns Copy into an explanation when the clipboard is unavailable", async () => {
		Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
		document.execCommand = vi.fn(() => false);
		const app = fakeApp({ connect_wallet: PAIRING, get_connect_status: { status: "pending" } });
		const m = mount(<Pairing app={app} onConnected={async () => {}} onCancel={() => {}} />);
		m.click("button[data-action=connect]");
		await m.flush();
		m.click("button[data-action=copy]");
		await m.flush();
		expect(m.container.querySelector("button[data-action=copy]")).toBeNull();
		expect(m.text()).toContain("Clipboard unavailable");
		m.unmount();
	});

	it("turns Open-in-wallet into an explanation when the host refuses the wc: link", async () => {
		const app = fakeApp({ connect_wallet: PAIRING, get_connect_status: { status: "pending" } });
		(app as unknown as { openLink: () => Promise<unknown> }).openLink = async () => ({
			isError: true,
		});
		const m = mount(<Pairing app={app} onConnected={async () => {}} onCancel={() => {}} />);
		m.click("button[data-action=connect]");
		await m.flush();
		m.click("button[data-action=open-wallet]");
		await m.flush();
		expect(m.container.querySelector("button[data-action=open-wallet]")).toBeNull();
		expect(m.text()).toContain("can't open wallet links");
		m.unmount();
	});

	it("calls onConnected once the pairing reports connected", async () => {
		vi.useFakeTimers();
		const onConnected = vi.fn(async () => {});
		const app = fakeApp({
			connect_wallet: PAIRING,
			get_connect_status: { status: "connected", address: "0x1" },
		});
		const m = mount(<Pairing app={app} onConnected={onConnected} onCancel={() => {}} />);
		m.click("button[data-action=connect]");
		await vi.advanceTimersByTimeAsync(1100);
		expect(onConnected).toHaveBeenCalled();
		vi.useRealTimers();
		m.unmount();
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run ui/src/pairing.test.tsx`
Expected: FAIL — `./pairing.js` does not exist.

- [ ] **Step 3: Write the component**

`ui/src/pairing.tsx` — port `Disconnected` from `ui/src/panel.tsx:402-540` (read it; the connect flow, the poll loop with `nextPoll`, and the `alive` ref are copied as they are) with these changes:

1. **`copyText`**, exported:

```tsx
export async function copyText(text: string): Promise<"clipboard" | "execCommand" | "unavailable"> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return "clipboard";
		}
	} catch {
		// fall through to the legacy path
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "");
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		ta.remove();
		if (ok) return "execCommand";
	} catch {
		// fall through
	}
	return "unavailable";
}
```

2. Two pieces of state replace `canCopy` and `linksAllowed`:

```tsx
const [copyState, setCopyState] = useState<"ready" | "copied" | "unavailable">("ready");
const [walletLink, setWalletLink] = useState<"ready" | "refused">("ready");
```

3. The Copy control:

```tsx
{
	copyState !== "unavailable" ? (
		<button
			class="ghost"
			data-action="copy"
			onClick={async () => {
				const how = await copyText(pairing.uri);
				if (!alive.current) return;
				if (how === "unavailable") setCopyState("unavailable");
				else {
					setCopyState("copied");
					setTimeout(() => alive.current && setCopyState("ready"), 1500);
				}
			}}
		>
			{copyState === "copied" ? "Copied" : "Copy link"}
		</button>
	) : (
		<span class="muted">Clipboard unavailable here — select the link above and copy it.</span>
	);
}
```

4. The wallet-link control (the `wc:` URI is passed to `openLink` unchanged, as `wallets.ts` did):

```tsx
{
	walletLink === "ready" ? (
		<button
			class="ghost"
			data-action="open-wallet"
			onClick={async () => {
				const r = await app.openLink({ url: pairing.uri });
				if (r.isError && alive.current) setWalletLink("refused");
			}}
		>
			Open in your wallet
		</button>
	) : (
		<span class="muted">This host can't open wallet links — scan the QR or copy the link.</span>
	);
}
```

5. Props: `{ app, onConnected, onCancel }`; the idle view's Connect button carries `data-action="connect"`; a _Back_ button (class `ghost`, `data-action="back"`) calls `onCancel` and is rendered in every phase — Task 6's shell test clicks it. The idle copy stays: "No wallet is connected. Pair your own wallet to sign from it."

6. Do not import from `./wallets.js` — it is deleted in Task 9.

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run ui/src/pairing.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test && pnpm typecheck && ./node_modules/.bin/prettier --check src/ ui/
```

```bash
git add -A && git commit -m "feat: the pairing view, with controls that explain rather than vanish"
```

---

### Task 5: The policy section — collapsed, danger on the wipe

**Files:**

- Create: `ui/src/policy.tsx`, `ui/src/policy.test.tsx`

**Interfaces:**

- Consumes: `callJson`, `explainError`, `policyRows` from `./status.js`, `PolicyState`, `SessionKind` from `./types.js`.
- Produces: `<PolicySection app initial sessionKind open? />`; `policySummary(p)`.

- [ ] **Step 1: Write the failing tests**

`ui/src/policy.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { PolicySection } from "./policy.js";
import { fakeApp, mount } from "./test-utils.js";

const ABSENT = { state: "absent" as const, path: "/p", message: "No signing policy is set." };
const ACTIVE = { state: "active" as const, rules: { maxValue: { base: "0.05" } }, path: "/p" };

describe("PolicySection", () => {
	it("starts collapsed with a one-line summary", () => {
		const m = mount(
			<PolicySection app={fakeApp({})} initial={ABSENT} sessionKind="walletconnect" />
		);
		expect(m.text()).toContain("Signing policy");
		expect(m.text()).toContain("none set");
		expect(m.container.querySelector("form")).toBeNull();
		m.unmount();
	});

	it("expands to the rules and the form", async () => {
		const m = mount(
			<PolicySection app={fakeApp({})} initial={ACTIVE} sessionKind="walletconnect" />
		);
		m.click("button[data-action=toggle-policy]");
		await m.flush();
		expect(m.text()).toContain("base.maxValue");
		expect(m.container.querySelector("form")).not.toBeNull();
		m.unmount();
	});

	// On the imported-key path the policy is the only bound on signing, so the
	// button that destroys it must not look like the one that backs out.
	it("puts danger on the button that performs the wipe, not on Keep", async () => {
		const m = mount(
			<PolicySection app={fakeApp({})} initial={ACTIVE} sessionKind="private-key" open />
		);
		m.click("button[data-action=wipe]");
		await m.flush();
		expect(m.q("button[data-action=wipe-confirm]").className).toContain("danger");
		expect(m.q("button[data-action=wipe-keep]").className).not.toContain("danger");
		m.unmount();
	});

	it("reloads from get_policy after a write, never trusting its own write", async () => {
		const app = fakeApp({ set_policy_rule: { ok: true }, get_policy: ACTIVE });
		const m = mount(
			<PolicySection app={app} initial={ABSENT} sessionKind="walletconnect" open />
		);
		m.type("input[aria-label=Value]", "0.05");
		m.click("button[type=submit]");
		await m.flush();
		expect(app.calls.map((c) => c.name)).toEqual(["set_policy_rule", "get_policy"]);
		expect(m.text()).toContain("base.maxValue");
		m.unmount();
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run ui/src/policy.test.tsx`
Expected: FAIL — `./policy.js` does not exist.

- [ ] **Step 3: Write the component**

`ui/src/policy.tsx` — port `PolicyCard` from `ui/src/panel.tsx:207-400` with these changes:

1. Props `{ app, initial: PolicyState, sessionKind: SessionKind, open?: boolean }`. State starts from `initial` (the snapshot already carries the policy — no fetch on mount). `load()` is still called after every write.
2. A collapsed header row, always rendered:

```tsx
<div class="row">
	<button class="ghost" data-action="toggle-policy" onClick={() => setOpen(!isOpen)}>
		{isOpen ? "▾" : "▸"} Signing policy
	</button>
	{policy.state === "active" && <span class="pill ok">active</span>}
	{policy.state === "absent" && (
		<span class={`pill ${sessionKind === "private-key" ? "warn" : ""}`}>none set</span>
	)}
	{policy.state === "unreadable" && <span class="pill err">unreadable</span>}
</div>
```

`isOpen` is `useState(open ?? false)`. The body — the rules table, the form, the `maxValue` caveat, the wipe row — renders only when `isOpen`.

3. The wipe row's buttons carry `data-action="wipe"` (the opener, `class="ghost danger"`), `data-action="wipe-confirm"` (`class="ghost danger"`), `data-action="wipe-keep"` (`class="ghost"`).
4. Errors go through `explainError(e, {}).title`, not `e.message`.
5. Export a second thing later tasks use: `export function policySummary(p: PolicyState): string` returning `"none set" | "active" | "unreadable"` — the header uses it and the shell's error handling opens the section on a `POLICY_BLOCKED` refusal by passing `open`.

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run ui/src/policy.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test && pnpm typecheck && ./node_modules/.bin/prettier --check src/ ui/
```

```bash
git add -A && git commit -m "feat: the policy section, collapsed by default"
```

---

### Task 6: The app — shell, swap form, one surface. Measure.

This is the composition. After it, the branch is usable end to end.

**Files:**

- Create: `ui/src/swap-form.tsx`, `ui/src/swap-form.test.tsx`, `ui/src/app.tsx`, `ui/src/app.test.tsx`
- Modify: `ui/src/main.tsx`, `ui/src/tokens.css`, `ui/index.html`, `src/mcp/ui.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 2-5 by the names given there; `formatImpact`, `formatUsd`, `routeLabel`, `hasRoute`, `nextTxPoll`, `checkSlippage`, `buildSwapArgs` from `./quote.js`; `shortAddress`, `describeSession` from `./status.js`.
- Produces: `<FibxApp app snapshot />`; the document marker `data-fibx-app`.

- [ ] **Step 1: Write the failing form tests**

`ui/src/swap-form.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { SwapForm } from "./swap-form.js";
import { fakeApp, mount } from "./test-utils.js";
import type { QuoteResult } from "./quote.js";

const QUOTE: QuoteResult = {
	input: "0.001 ETH",
	output: "~2.45 USDC",
	rate: "1 ETH ≈ 2450 USDC",
	chain: "base",
	slippage: "0.5%",
	router: "0xr",
	quote: {
		fromToken: "ETH",
		toToken: "USDC",
		inputAmount: "0.001",
		outputAmount: "2.45",
		minReceived: "2.43",
		slippage: 0.5,
		usdIn: 2.45,
		usdOut: 2.45,
		priceImpact: 0.02,
		route: [{ protocol: 1, displayName: "Hydrex", pool: "0xp" }],
		routerAddress: "0xr",
		chain: "base",
	},
};
const TERMS = { from: "ETH", to: "USDC", amount: "0.001", slippage: 0.5 };
const SIM = {
	success: true,
	mode: "SIMULATION",
	amountIn: "0.001",
	amountOut: "2.45",
	tokenIn: "ETH",
	tokenOut: "USDC",
	chain: "base",
	requiresApproval: false,
};

function form(overrides: Partial<Parameters<typeof SwapForm>[0]> = {}, answers = {}) {
	const app = fakeApp({ get_quote: QUOTE, swap_tokens: SIM, ...answers });
	const m = mount(
		<SwapForm
			app={app}
			chain="base"
			terms={TERMS}
			quote={QUOTE}
			balances={{ ETH: "0.01" }}
			connected
			onPickToken={() => {}}
			{...overrides}
		/>
	);
	return { app, m };
}

describe("SwapForm", () => {
	it("draws the quote: amounts, rate, route", () => {
		const { m } = form();
		expect(m.text()).toContain("2.45");
		expect(m.text()).toContain("Hydrex");
		m.unmount();
	});

	it("keeps Swap disabled until a simulate succeeds", async () => {
		const { m } = form();
		expect((m.q("button[data-action=swap]") as HTMLButtonElement).disabled).toBe(true);
		m.click("button[data-action=simulate]");
		await m.flush();
		expect((m.q("button[data-action=swap]") as HTMLButtonElement).disabled).toBe(false);
		m.unmount();
	});

	// The raw eth_estimateGas dump the first real use saw. Now the form knows
	// the balance and refuses before any call is made.
	it("blocks Simulate and names the shortfall when the amount exceeds the balance", () => {
		const { m, app } = form({ balances: { ETH: "0.0002" } });
		expect((m.q("button[data-action=simulate]") as HTMLButtonElement).disabled).toBe(true);
		expect(m.text()).toContain("Insufficient balance");
		expect(m.text()).toContain("0.0002 ETH");
		expect(app.calls.filter((c) => c.name === "swap_tokens")).toHaveLength(0);
		m.unmount();
	});

	it("re-quotes when the amount changes, after a debounce, and re-locks Swap", async () => {
		vi.useFakeTimers();
		const { m, app } = form();
		m.click("button[data-action=simulate]");
		await vi.advanceTimersByTimeAsync(0);
		expect((m.q("button[data-action=swap]") as HTMLButtonElement).disabled).toBe(false);
		m.type("input[data-field=amount]", "0.002");
		expect((m.q("button[data-action=swap]") as HTMLButtonElement).disabled).toBe(true);
		expect(app.calls.filter((c) => c.name === "get_quote")).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(450);
		expect(app.calls.filter((c) => c.name === "get_quote")).toHaveLength(1);
		expect(app.calls.at(-1)?.args.amount).toBe("0.002");
		vi.useRealTimers();
		m.unmount();
	});

	it("never calls swap_tokens on its own", async () => {
		vi.useFakeTimers();
		const { m, app } = form();
		m.type("input[data-field=amount]", "0.003");
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.calls.filter((c) => c.name === "swap_tokens")).toHaveLength(0);
		vi.useRealTimers();
		m.unmount();
	});

	// The duplicate-swap hole, now under test rather than hand verification.
	it("locks every control once a broadcast never resolves", async () => {
		vi.useFakeTimers();
		const { m } = form(
			{},
			{
				swap_tokens: (args: Record<string, unknown>) =>
					args.simulate
						? SIM
						: {
								txHash: "0xh",
								amountIn: "0.001",
								amountOut: "2.45",
								tokenIn: "ETH",
								tokenOut: "USDC",
								chain: "base",
							},
				get_tx_status: new Error("receipt not found"),
			}
		);
		m.click("button[data-action=simulate]");
		await vi.advanceTimersByTimeAsync(0);
		m.click("button[data-action=swap]");
		await vi.advanceTimersByTimeAsync(0);
		// Past MAX_POLL_ATTEMPTS seconds of "not mined yet".
		await vi.advanceTimersByTimeAsync(125_000);
		expect(m.text()).toContain("0xh");
		for (const sel of [
			"button[data-action=swap]",
			"button[data-action=simulate]",
			"input[data-field=amount]",
			"input[data-field=slippage]",
		]) {
			expect((m.q(sel) as HTMLButtonElement).disabled).toBe(true);
		}
		vi.useRealTimers();
		m.unmount();
	});

	it("explains a simulate failure in the user's language", async () => {
		const { m } = form(
			{},
			{ swap_tokens: new Error("UserRejectedRequestError: User rejected the request") }
		);
		m.click("button[data-action=simulate]");
		await m.flush();
		expect(m.text()).toContain("Rejected in your wallet");
		expect(m.text()).not.toContain("UserRejectedRequestError");
		m.unmount();
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run ui/src/swap-form.test.tsx`
Expected: FAIL — `./swap-form.js` does not exist.

- [ ] **Step 3: Write the form**

`ui/src/swap-form.tsx`. Props:

```tsx
export function SwapForm({
	app,
	chain,
	terms,
	quote,
	quoteError,
	balances,
	connected,
	onPickToken,
	onPolicyRefusal,
}: {
	app: App;
	chain: string;
	terms: Terms;
	quote: QuoteResult | null;
	quoteError?: string | null;
	balances: Record<string, string> | null;
	connected: boolean;
	/** The shell opens the picker; the form only says which side. */
	onPickToken: (side: "from" | "to") => void;
	onPolicyRefusal?: () => void;
});
```

Structure — the machine owns the flow, the component owns rendering and I/O:

1. `const [state, setState] = useState<State>(() => initialState(terms, quote));` and `const dispatch = (ev: Event) => setState((s) => transition(s, ev));`. When `terms`/`quote` props change (the shell re-seeds after a picker choice or a chain change), dispatch `TERMS_CHANGED` then, if a quote came with it, `QUOTE_ARRIVED`.
2. **Amount input** `input[data-field=amount]` (`inputMode="decimal"`), **slippage input** `input[data-field=slippage]` — both `disabled={isLocked(state)}`. An amount or slippage edit dispatches `TERMS_CHANGED` immediately (which locks Swap), then after a **400 ms debounce** (a `setTimeout` in a ref, cleared on every edit and on unmount) calls `get_quote` with `{ amount, from_token, to_token, chain, slippage }` and dispatches `QUOTE_ARRIVED` / `QUOTE_FAILED`. Slippage goes through `checkSlippage` first; a refusal is shown inline and no quote is fetched.
3. **Token buttons** `button[data-action=pick-from]` / `pick-to` call `onPickToken`. **Direction arrow** `button[data-action=flip]` dispatches `TERMS_CHANGED` with from/to swapped and the destination amount as the new source amount when there is one.
4. **Balance line** under the source amount: `bal ${balances?.[terms.from] ?? "—"}` when `connected`.
5. **Shortfall**: `const short = connected && balances?.[terms.from] !== undefined && Number(terms.amount) > Number(balances[terms.from])`. When `short`, render `explainError(new Error("insufficient"), { symbol: terms.from, amount: terms.amount, balance: balances[terms.from] })` as an error block, and Simulate is disabled.
6. **Price info**: rate, impact via `formatImpact` → `.pill.ok/warn/err` (map `bad → err`), "price impact unknown" when null, route pills via `routeLabel`, `≈ minReceived` labelled _(est.)_.
7. **Footer**: `button[data-action=simulate]` disabled when `isLocked(state) || short || !("quote" in state) || state.quote === null`; `button[data-action=swap]` disabled when `isLocked(state) || !canSwap(state)`. Simulate dispatches `SIMULATE`, calls `swap_tokens` with `buildSwapArgs(quote, true)`, dispatches `SIMULATED`/`SIMULATE_FAILED`. Swap dispatches `SWAP`, calls `buildSwapArgs(quote, false)`, dispatches `BROADCAST`/`SWAP_FAILED`, then polls `get_tx_status` exactly as `swap-card.tsx:234-297` does, dispatching `RECEIPT` or `POLL_EXPIRED`. **A throw from `get_tx_status` is "not mined yet"** (viem's `getTransactionReceipt` throws until mined) — only a resolved `confirmed`/`reverted` is terminal. Reuse `nextTxPoll`.
8. **Telling the model** — port `tellModel` from `swap-card.tsx:86-88` and the four sentences (broadcast = pending, confirmed, reverted, unknown) from `swap-card.tsx:229-293` verbatim. The confirmed sentence leads with the uncertainty: `Swap settled on ${chain} in block ${n} — tx ${hash}. The received amount is not confirmed by this widget; ${amountOut} ${tokenOut} was the quote at broadcast. Read the balance for the exact figure.` Add a fifth, on every `QUOTE_ARRIVED` that came from the user's own edit (not the seeded one): `Quote in the FibX app: ${inputAmount} ${fromToken} → ${outputAmount} ${toToken} on ${chain}, ${route.length} hop(s). Not swapped.` — the model otherwise still believes the amounts it was first shown.
9. **Errors**: every `failed` state renders `explainError(...)` — `title` as the headline, `detail` beneath, `raw` inside a `<details>` element. When `action === "policy"` call `onPolicyRefusal?.()`. When `afterSwapAttempt`, the approval note from `swap-card.tsx:528-534`.
10. **Disclosure** when `state.kind === "simulated"` and `sim.requiresApproval`: the two-transactions sentence.
11. **After a broadcast**: the pill/hash/explorer row from `swap-card.tsx:478-509`; the explorer button explains itself in place if `openLink` returns `isError` (same pattern as Task 4's wallet link).
12. The `alive` ref, checked after every `await` before any dispatch. `tellModel` sets no state.

CSS to add in `tokens.css`: `.field` (label + input + meta stack), `.token-btn` (brand-hover pill button with a `▾`), `.flip` (a centred ghost button), `.price-info` (small mono rows). Keep the existing tokens; add no colours.

- [ ] **Step 4: Run the form tests**

Run: `pnpm exec vitest run ui/src/swap-form.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing shell tests**

`ui/src/app.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { FibxApp } from "./app.js";
import { fakeApp, mount } from "./test-utils.js";
import type { Snapshot } from "./types.js";

const BASE: Snapshot = {
	chain: "base",
	auth: {
		authenticated: false,
		walletAddress: null,
		sessionType: null,
		chain: "base",
		requiresApprovalPerTransaction: false,
		fibrousStatus: "ok",
	},
	balances: null,
	policy: { state: "absent", path: "/p", message: "No signing policy is set." },
	terms: null,
	quote: null,
	quoteError: null,
};

describe("FibxApp", () => {
	it("renders the whole app from a bare snapshot: header, form, policy", () => {
		const m = mount(<FibxApp app={fakeApp({})} snapshot={BASE} />);
		expect(m.container.querySelector("[data-fibx-app]")).not.toBeNull();
		expect(m.text()).toContain("Connect");
		expect(m.container.querySelector("input[data-field=amount]")).not.toBeNull();
		expect(m.text()).toContain("Signing policy");
		m.unmount();
	});

	it("shows the address when connected", () => {
		const snap = {
			...BASE,
			auth: {
				...BASE.auth,
				authenticated: true,
				walletAddress: "0x0363000000000000000000000000000000003d44",
				sessionType: "walletconnect" as const,
			},
			balances: { ETH: "0.0002" },
		};
		const m = mount(<FibxApp app={fakeApp({})} snapshot={snap} />);
		expect(m.text()).toContain("0x0363…3d44");
		m.unmount();
	});

	it("pre-fills the form from terms and shows a pre-fetched quote error in place", () => {
		const snap = {
			...BASE,
			terms: { from: "XYZ", to: "USDC", amount: "1", slippage: 0.5 },
			quoteError: "Token not found: XYZ",
		};
		const m = mount(<FibxApp app={fakeApp({})} snapshot={snap} />);
		expect((m.q("input[data-field=amount]") as HTMLInputElement).value).toBe("1");
		expect(m.text()).toContain("XYZ");
		expect(m.text()).toContain("not on this chain");
		m.unmount();
	});

	it("opens the picker from a token button and closes it on pick", async () => {
		const tokens = {
			chain: "base",
			tokens: [{ symbol: "USDC", name: "USD Coin", address: "0x2", decimals: 6 }],
		};
		const m = mount(<FibxApp app={fakeApp({ list_tokens: tokens })} snapshot={BASE} />);
		m.click("button[data-action=pick-from]");
		await m.flush();
		expect(m.container.querySelector(".picker")).not.toBeNull();
		m.click('[data-token="USDC"]');
		await m.flush();
		expect(m.container.querySelector(".picker")).toBeNull();
		m.unmount();
	});

	it("switches to the pairing view from Connect and back on cancel", async () => {
		const m = mount(<FibxApp app={fakeApp({})} snapshot={BASE} />);
		m.click("button[data-action=wallet]");
		await m.flush();
		expect(m.container.querySelector("button[data-action=connect]")).not.toBeNull();
		m.click("button[data-action=back]");
		await m.flush();
		expect(m.container.querySelector("input[data-field=amount]")).not.toBeNull();
		m.unmount();
	});
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm exec vitest run ui/src/app.test.tsx`
Expected: FAIL — `./app.js` does not exist.

- [ ] **Step 7: Write the shell**

`ui/src/app.tsx`:

```tsx
import { useState } from "preact/hooks";
import type { App } from "@modelcontextprotocol/ext-apps";
import { callJson } from "./rpc.js";
import { explainError } from "./errors.js";
import { shortAddress } from "./status.js";
import { Pairing } from "./pairing.js";
import { PolicySection } from "./policy.js";
import { SwapForm } from "./swap-form.js";
import { TokenPicker } from "./picker.js";
import type { AuthStatus, Snapshot, Terms, TokenInfo } from "./types.js";

const CHAINS = ["base", "hyperevm", "monad"] as const;
const NATIVE: Record<string, string> = { base: "ETH", hyperevm: "HYPE", monad: "MON" };

type View = { kind: "form" } | { kind: "pairing" } | { kind: "picker"; side: "from" | "to" };

function defaultTerms(chain: string): Terms {
	return { from: NATIVE[chain] ?? "ETH", to: "USDC", amount: "", slippage: 0.5 };
}

export function FibxApp({ app, snapshot }: { app: App; snapshot: Snapshot }) {
	const [chain, setChain] = useState(snapshot.chain);
	const [auth, setAuth] = useState<AuthStatus>(snapshot.auth);
	const [balances, setBalances] = useState(snapshot.balances);
	const [terms, setTerms] = useState<Terms>(snapshot.terms ?? defaultTerms(snapshot.chain));
	const [quote, setQuote] = useState(snapshot.quote);
	const [quoteError, setQuoteError] = useState(snapshot.quoteError);
	const [view, setView] = useState<View>({ kind: "form" });
	const [policyOpen, setPolicyOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function refresh() {
		try {
			const a = await callJson<AuthStatus>(app, "get_auth_status", { chain });
			setAuth(a);
			if (a.authenticated) {
				const b = await callJson<{ balances: Record<string, string> }>(app, "get_balance", {
					chain,
				});
				setBalances(b.balances);
			} else {
				setBalances(null);
			}
			void app
				.updateModelContext({
					content: [
						{
							type: "text",
							text: a.authenticated
								? `Wallet connected: ${a.walletAddress} on ${chain}`
								: "No wallet connected.",
						},
					],
				})
				.catch(() => {});
		} catch (e) {
			setError(explainError(e, {}).title);
		}
	}

	function changeChain(next: string) {
		setChain(next);
		setTerms(defaultTerms(next));
		setQuote(null);
		setQuoteError(null);
		void refresh();
	}

	function picked(side: "from" | "to", t: TokenInfo) {
		setTerms((cur) => ({ ...cur, [side]: t.symbol }));
		setQuote(null);
		setQuoteError(null);
		setView({ kind: "form" });
	}

	async function endSession() {
		try {
			await callJson(app, "logout", {});
			await refresh();
		} catch (e) {
			setError(explainError(e, {}).title);
		}
	}

	return (
		<div data-fibx-app class="app">
			<header class="row app-header">
				<span class="brand">FibX</span>
				<select
					class="mono"
					value={chain}
					aria-label="Chain"
					onChange={(e) => changeChain(e.currentTarget.value)}
				>
					{CHAINS.map((c) => (
						<option value={c} key={c}>
							{c}
						</option>
					))}
				</select>
				{auth.authenticated && auth.walletAddress ? (
					<button
						class="ghost mono"
						data-action="wallet"
						title={auth.walletAddress}
						onClick={endSession}
					>
						{shortAddress(auth.walletAddress)} · end
					</button>
				) : (
					<button data-action="wallet" onClick={() => setView({ kind: "pairing" })}>
						Connect
					</button>
				)}
			</header>

			{error && <p class="error">{error}</p>}

			{view.kind === "pairing" && (
				<Pairing
					app={app}
					onConnected={async () => {
						await refresh();
						setView({ kind: "form" });
					}}
					onCancel={() => setView({ kind: "form" })}
				/>
			)}

			{view.kind === "picker" && (
				<TokenPicker
					app={app}
					chain={chain}
					exclude={view.side === "from" ? terms.to : terms.from}
					onPick={(t) => picked(view.side, t)}
					onClose={() => setView({ kind: "form" })}
				/>
			)}

			{view.kind === "form" && (
				<SwapForm
					app={app}
					chain={chain}
					terms={terms}
					quote={quote}
					quoteError={quoteError}
					balances={balances}
					connected={auth.authenticated}
					onPickToken={(side) => setView({ kind: "picker", side })}
					onPolicyRefusal={() => setPolicyOpen(true)}
				/>
			)}

			<PolicySection
				app={app}
				initial={snapshot.policy}
				sessionKind={auth.sessionType ?? "walletconnect"}
				open={policyOpen}
			/>
		</div>
	);
}
```

The pairing view's _Back_ button carries `data-action="back"` (add it to `Pairing` if Task 4 named it differently — the test above is the contract).

- [ ] **Step 8: One surface in `main.tsx`**

Replace `ui/src/main.tsx`:

```tsx
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { App } from "@modelcontextprotocol/ext-apps";
import { FibxApp } from "./app.js";
import { parseToolJson } from "./status.js";
import type { Snapshot } from "./types.js";
import "./tokens.css";

const app = new App({ name: "FibX", version: "1.0.0" });

if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
	document.documentElement.classList.add("dark");
}

/**
 * withErrorHandling (src/mcp/tools/error-handling.ts) returns a failure as an
 * ordinary result with `{ success: false, error }` and no `isError`, so the
 * host still renders this document. Nothing here is actionable then.
 */
function toolError(payload: unknown): string | null {
	if (payload === null || typeof payload !== "object") return null;
	const body = payload as { success?: unknown; error?: unknown };
	if (body.success !== false) return null;
	return typeof body.error === "string" && body.error !== ""
		? body.error
		: "The tool call failed.";
}

function Root() {
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
	const [failure, setFailure] = useState<string | null>(null);

	useEffect(() => {
		app.addEventListener("toolresult", (result) => {
			try {
				const parsed = parseToolJson<Snapshot>(result);
				const f = toolError(parsed);
				if (f) {
					setFailure(f);
					return;
				}
				setSnapshot(parsed);
			} catch (e) {
				setFailure(e instanceof Error ? e.message : String(e));
			}
		});
		app.connect().catch((e: unknown) => setFailure(`connect failed: ${String(e)}`));
		return () => {
			app.close().catch(() => {});
		};
	}, []);

	if (failure) {
		return (
			<div data-fibx-app class="app">
				<span class="brand">FibX</span>
				<p class="error">{failure}</p>
			</div>
		);
	}
	if (!snapshot) {
		return (
			<div data-fibx-app class="app">
				<span class="brand">FibX</span>
				<p class="muted">opening…</p>
			</div>
		);
	}
	return <FibxApp app={app} snapshot={snapshot} />;
}

render(<Root />, document.getElementById("root")!);
```

Change `ui/index.html`'s `<title>` to `FibX`. In `src/mcp/ui.test.ts`, change the marker assertion from `data-fibx-panel` to `data-fibx-app`.

- [ ] **Step 9: Run everything, then measure**

```bash
pnpm test && pnpm typecheck && ./node_modules/.bin/prettier --check src/ ui/
```

```bash
pnpm build:ui && node -e "const fs=require('fs');console.log(Buffer.byteLength(fs.readFileSync('ui/dist/index.html','utf8')), 'bytes')"
```

**Record the number in the commit message.** The guard is 400,000 bytes. The old `panel.tsx` and `swap-card.tsx` are still in the tree but no longer imported, so Vite tree-shakes them; if the number is over 380,000 say so in the report — Task 9 removes the dead files but they cost nothing now, so the headroom after Task 9 is what this number already shows.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: one FibX app — shell, swap form, one surface (<N> bytes)"
```

---

### Task 7: The dev host — fixture mode

**Files:**

- Create: `ui/dev-host/index.html`, `ui/dev-host/host.ts`, `ui/dev-host/vite.config.ts`, `ui/dev-host/fixtures/bare.json`, `ui/dev-host/fixtures/connected.json`, `ui/dev-host/fixtures/quoted.json`, `ui/dev-host/fixtures/quote-error.json`, `ui/dev-host/fixtures/tokens.json`, `ui/dev-host/fixtures/tools.json`
- Modify: `package.json` (script), `ui/tsconfig.json` (include)

**Interfaces:**

- Consumes: `AppBridge`, `PostMessageTransport` from `@modelcontextprotocol/ext-apps` (host side — verify the export path in `node_modules/@modelcontextprotocol/ext-apps/package.json` `exports`; it may be the package root or a `/host` subpath). `AppBridge`'s constructor is `(client: Client | null, hostInfo: Implementation, capabilities: McpUiHostCapabilities, options?: { hostContext?: McpUiHostContext })`; with `client: null` the host answers tool calls itself via `bridge.oncalltool`. `bridge.connect(transport)`, `bridge.oninitialized`, `bridge.sendToolResult(callToolResult)`, `bridge.onopenlink`, `bridge.onupdatemodelcontext`.
- Produces: `pnpm dev:ui`.

- [ ] **Step 1: Fixtures**

`ui/dev-host/fixtures/bare.json` — an `open_fibx` snapshot with `authenticated: false`, `policy.state: "absent"`, `terms: null`, `quote: null`.

`connected.json` — `authenticated: true`, `walletAddress: "0x0363000000000000000000000000000000003d44"`, `sessionType: "walletconnect"`, `balances: { "ETH": "0.0002" }`, `policy.state: "active"` with `rules.maxValue.base = "0.05"`.

`quoted.json` — `connected.json` plus `terms: { from: "ETH", to: "USDC", amount: "0.001", slippage: 0.5 }` and a full routed `quote` (copy `QUOTE` from `ui/src/swap-form.test.tsx`, with a four-hop route: PancakeSwap V3, BaseSwap V3, PancakeSwap Infinity, BaseSwap V3).

`quote-error.json` — `terms: { from: "XYZ", to: "USDC", amount: "1", slippage: 0.5 }`, `quote: null`, `quoteError: "Token not found: XYZ"`.

`tokens.json` — `{ chain: "base", tokens: [...] }` with ~12 tokens including ETH, WETH, USDC, cbBTC, DAI, AERO, ZRO.

`tools.json` — canned answers for `callServerTool`, keyed by tool name, each either a body or a list of bodies returned in sequence:

```json
{
	"get_quote": { "$ref": "quoted.json#/quote" },
	"list_tokens": { "$ref": "tokens.json" },
	"swap_tokens": [
		{
			"success": true,
			"mode": "SIMULATION (no TX sent)",
			"amountIn": "0.001",
			"amountOut": "2.45",
			"tokenIn": "ETH",
			"tokenOut": "USDC",
			"chain": "base",
			"requiresApproval": false,
			"estimatedGas": "210000"
		},
		{
			"txHash": "0xabc123",
			"amountIn": "0.001",
			"amountOut": "2.45",
			"tokenIn": "ETH",
			"tokenOut": "USDC",
			"chain": "base",
			"explorer": "https://basescan.org/tx/0xabc123"
		}
	],
	"get_tx_status": [
		{ "success": false, "error": "Transaction receipt not found — it may still be pending" },
		{ "success": false, "error": "Transaction receipt not found — it may still be pending" },
		{
			"hash": "0xabc123",
			"status": "confirmed",
			"blockNumber": "123",
			"explorer": "https://basescan.org/tx/0xabc123"
		}
	],
	"get_auth_status": { "$ref": "connected.json#/auth" },
	"get_balance": { "wallet": "0x0363…", "chain": "base", "balances": { "ETH": "0.0002" } },
	"get_policy": { "$ref": "connected.json#/policy" },
	"connect_wallet": {
		"uri": "wc:deadbeef@2?relay-protocol=irn&symKey=00",
		"qrDataUri": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='120' height='120' fill='white'/><text x='10' y='60'>QR</text></svg>",
		"pairingId": "p1"
	},
	"get_connect_status": [
		{ "status": "pending" },
		{ "status": "pending" },
		{ "status": "connected", "address": "0x0363000000000000000000000000000000003d44" }
	],
	"logout": { "ok": true },
	"set_policy_rule": { "ok": true },
	"clear_policy_rule": { "ok": true }
}
```

Implement `$ref` in `host.ts` as a tiny resolver (file, optional JSON-pointer fragment) — not a library. Add a `"revert"` and a `"insufficient"` variant switchable from the page: `swap_tokens` broadcast followed by `get_tx_status` → `reverted`; and `swap_tokens` simulate → `{ success: false, error: "Transaction creation failed. URL: https://mainnet.base.org Request body: {...eth_estimateGas...}" }`.

- [ ] **Step 2: The page**

`ui/dev-host/index.html`:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<title>FibX dev host</title>
		<style>
			body {
				font: 14px system-ui;
				margin: 0;
				display: grid;
				grid-template-columns: 260px 1fr;
				height: 100vh;
			}
			aside {
				padding: 12px;
				border-right: 1px solid #ccc;
				overflow: auto;
			}
			iframe {
				width: 100%;
				height: 100%;
				border: 0;
			}
			pre {
				font-size: 11px;
				white-space: pre-wrap;
			}
			label {
				display: block;
				margin: 6px 0;
			}
		</style>
	</head>
	<body>
		<aside>
			<h3>Snapshot</h3>
			<label><input type="radio" name="fixture" value="bare" checked /> bare</label>
			<label><input type="radio" name="fixture" value="connected" /> connected</label>
			<label><input type="radio" name="fixture" value="quoted" /> quoted</label>
			<label><input type="radio" name="fixture" value="quote-error" /> quote error</label>
			<h3>Outcome</h3>
			<label><input type="radio" name="outcome" value="confirmed" checked /> confirmed</label>
			<label><input type="radio" name="outcome" value="reverted" /> reverted</label>
			<label
				><input type="radio" name="outcome" value="unknown" /> unknown (never mined)</label
			>
			<label
				><input type="radio" name="outcome" value="insufficient" /> simulate:
				insufficient</label
			>
			<h3>Host</h3>
			<label><input type="checkbox" id="clipboard" checked /> grant clipboardWrite</label>
			<label><input type="checkbox" id="wclinks" /> accept wc: in openLink</label>
			<label
				>Mode
				<select id="mode">
					<option value="fixtures">fixtures</option>
					<option value="live">live (bridge on :7331)</option>
				</select></label
			>
			<button id="reload">Reload widget</button>
			<h3>Model context</h3>
			<pre id="model"></pre>
			<h3>Calls</h3>
			<pre id="calls"></pre>
		</aside>
		<iframe id="widget" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
		<script type="module" src="./host.ts"></script>
	</body>
</html>
```

- [ ] **Step 3: The host**

`ui/dev-host/host.ts` — the shape; the implementer reads `app-bridge.d.ts` for exact signatures:

```typescript
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps"; // or the host subpath — check package.json exports

const iframe = document.getElementById("widget") as HTMLIFrameElement;
const modelOut = document.getElementById("model")!;
const callsOut = document.getElementById("calls")!;

async function fixture(name: string): Promise<unknown> {
	const r = await fetch(`./fixtures/${name}.json`);
	return r.json();
}

// $ref: "file.json" or "file.json#/path/to/key". Fixtures only; not a library.
async function resolveRefs(v: unknown): Promise<unknown> {
	if (Array.isArray(v)) return Promise.all(v.map(resolveRefs));
	if (v === null || typeof v !== "object") return v;
	const o = v as Record<string, unknown>;
	if (typeof o.$ref === "string") {
		const [file, pointer = ""] = o.$ref.split("#");
		let target = await resolveRefs(await fixture(file.replace(/\.json$/, "")));
		for (const key of pointer.split("/").filter(Boolean)) {
			target = (target as Record<string, unknown>)[key];
		}
		return target;
	}
	const out: Record<string, unknown> = {};
	for (const [k, val] of Object.entries(o)) out[k] = await resolveRefs(val);
	return out;
}

function radio(name: string): string {
	return (document.querySelector(`input[name=${name}]:checked`) as HTMLInputElement).value;
}

let sequence = new Map<string, number>();

async function answer(name: string, args: Record<string, unknown>): Promise<unknown> {
	const mode = (document.getElementById("mode") as HTMLSelectElement).value;
	if (mode === "live") {
		const r = await fetch("http://localhost:7331/call", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name, arguments: args }),
		});
		return r.json(); // the CallToolResult, verbatim
	}
	const table = (await resolveRefs(await fixture("tools"))) as Record<string, unknown>;
	const outcome = radio("outcome");
	// outcome overrides for swap_tokens / get_tx_status per the fixture notes
	let entry = table[name];
	if (Array.isArray(entry)) {
		const i = sequence.get(name) ?? 0;
		sequence.set(name, i + 1);
		entry = entry[Math.min(i, entry.length - 1)];
	}
	return { content: [{ type: "text", text: JSON.stringify(entry) }] };
}

async function boot() {
	sequence = new Map();
	iframe.src = "/dist/index.html?" + Date.now();
	await new Promise((r) => (iframe.onload = r));

	const grantClipboard = (document.getElementById("clipboard") as HTMLInputElement).checked;
	const bridge = new AppBridge(
		null,
		{ name: "fibx-dev-host", version: "0" },
		{
			serverTools: {},
			openLinks: {},
			updateModelContext: {},
			sandbox: { permissions: grantClipboard ? { clipboardWrite: {} } : {} },
		},
		{
			hostContext: {
				toolInfo: { tool: { name: "open_fibx", inputSchema: { type: "object" } } },
				theme: "dark",
			},
		}
	);

	bridge.oncalltool = async (params) => {
		callsOut.textContent += `${params.name} ${JSON.stringify(params.arguments ?? {})}\n`;
		return (await answer(params.name, params.arguments ?? {})) as never;
	};
	bridge.onopenlink = async ({ url }) => {
		const ok =
			url.startsWith("http") ||
			(document.getElementById("wclinks") as HTMLInputElement).checked;
		callsOut.textContent += `openLink ${url} → ${ok ? "ok" : "refused"}\n`;
		return ok ? {} : { isError: true };
	};
	bridge.onupdatemodelcontext = async (params) => {
		modelOut.textContent +=
			params.content.map((c) => ("text" in c ? c.text : "")).join("\n") + "\n\n";
		return {};
	};
	bridge.oninitialized = async () => {
		const snap = await resolveRefs(await fixture(radio("fixture")));
		await bridge.sendToolResult({ content: [{ type: "text", text: JSON.stringify(snap) }] });
	};

	await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
}

document.getElementById("reload")!.addEventListener("click", () => void boot());
void boot();
```

Whether the sandbox `allow` attribute for clipboard must be set on the iframe by the host page (`iframe.allow = "clipboard-write"`) is exactly what the _grant clipboardWrite_ checkbox should control — set it before `iframe.src` when checked, leave it unset when not. That is how the vanishing-button case is reproduced.

- [ ] **Step 4: Vite config and script**

`ui/dev-host/vite.config.ts`:

```typescript
import { defineConfig } from "vite";

// Dev only. Root is `ui` so the built widget at ui/dist/index.html is served
// as /dist/index.html for the iframe; the page itself is /dev-host/.
export default defineConfig({
	root: "ui",
	server: { open: "/dev-host/index.html" },
});
```

In `package.json` scripts: `"dev:ui": "pnpm build:ui && vite -c ui/dev-host/vite.config.ts"`.

In `ui/tsconfig.json`, `include` becomes `["src/**/*.ts", "src/**/*.tsx", "dev-host/host.ts"]`.

- [ ] **Step 5: Run it and look**

```bash
pnpm dev:ui
```

Open the page (Vite prints the URL). Walk every fixture and every outcome. **Screenshot each state into the report** — the reviewer cannot see a dev server. The states that matter:

- _bare_ → Connect → Copy with clipboard granted (says "Copied") and refused (turns into the sentence); _Open in your wallet_ with `wc:` accepted (call logged ok) and refused (turns into the sentence).
- _quoted_ → Simulate → Swap → confirmed; the Model context pane shows _pending_ then _settled_.
- _quoted_ + _reverted_: the model pane says reverted, no tokens changed hands.
- _quoted_ + _unknown_: after the poll window every control is disabled, the hash stays.
- _quoted_ + _insufficient_: the form says _Insufficient balance_ — but note this fixture's balance is 0.0002 and the amount 0.001, so the form should refuse **before** Simulate; switch the amount to 0.0001 to reach the simulate error and see it explained.
- _quote-error_: the picker action is offered.

- [ ] **Step 6: Verify and commit**

```bash
pnpm test && pnpm typecheck && ./node_modules/.bin/prettier --check src/ ui/
```

The dev host must not affect the production document: run `pnpm build:ui` and confirm the byte count is unchanged from Task 6.

```bash
git add -A && git commit -m "feat: a dev host that renders the widget against fixtures"
```

---

### Task 8: The dev host — live bridge

**Files:**

- Create: `ui/dev-host/bridge.ts`
- Modify: `package.json` (script), `tsconfig.json` (include)

**Interfaces:**

- Consumes: `Client` from `@modelcontextprotocol/sdk/client/index.js`, `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio.js`; `node:http`.
- Produces: `POST http://localhost:7331/call` `{ name, arguments }` → the `CallToolResult` JSON; `pnpm dev:ui:bridge`.

- [ ] **Step 1: The relay**

`ui/dev-host/bridge.ts`:

```typescript
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * The browser cannot spawn a stdio process, so this relay does: it runs the
 * built server, holds one MCP client to it, and answers the dev host's
 * callServerTool over plain HTTP. Dev only; not built, not published.
 *
 * It talks to the REAL server — a real session, a real policy file, real
 * quotes. A Swap from the dev host in live mode is a real swap.
 */
const PORT = 7331;

const transport = new StdioClientTransport({
	command: "node",
	args: ["dist/index.js", "mcp-start"],
});
const client = new Client({ name: "fibx-dev-host-bridge", version: "0" });
await client.connect(transport);

createServer(async (req, res) => {
	res.setHeader("access-control-allow-origin", "*");
	res.setHeader("access-control-allow-headers", "content-type");
	if (req.method === "OPTIONS") return void res.end();
	if (req.method !== "POST" || req.url !== "/call") {
		res.statusCode = 404;
		return void res.end();
	}
	let body = "";
	for await (const chunk of req) body += chunk;
	const { name, arguments: args } = JSON.parse(body) as {
		name: string;
		arguments?: Record<string, unknown>;
	};
	try {
		const result = await client.callTool({ name, arguments: args ?? {} });
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify(result));
	} catch (e) {
		res.statusCode = 500;
		res.end(
			JSON.stringify({
				content: [
					{ type: "text", text: JSON.stringify({ success: false, error: String(e) }) },
				],
			})
		);
	}
}).listen(PORT, () => console.log(`fibx dev bridge on http://localhost:${PORT}`));
```

Script: `"dev:ui:bridge": "pnpm build && tsx ui/dev-host/bridge.ts"`. Add `"ui/dev-host/bridge.ts"` to the root `tsconfig.json`'s `include` (it is Node code and needs `@types/node`, which `ui/tsconfig.json` deliberately excludes with `types: []`).

- [ ] **Step 2: Try it**

In one terminal `pnpm dev:ui:bridge`, in another `pnpm dev:ui`, switch the page's mode to _live_, reload the widget. `list_tokens` and `get_quote` should return real data. **Do not press Swap in live mode during this task** — that is Task 10's job with a human and a chosen amount.

- [ ] **Step 3: Verify and commit**

```bash
pnpm test && pnpm typecheck && ./node_modules/.bin/eslint src/ && ./node_modules/.bin/prettier --check src/ ui/
```

```bash
git add -A && git commit -m "feat: a live bridge so the dev host can talk to the real server"
```

---

### Task 9: Remove the old surfaces, update the handoff, measure

**Files:**

- Delete: `ui/src/panel.tsx`, `ui/src/swap-card.tsx`, `ui/src/wallets.ts`, `ui/src/wallets.test.ts`
- Modify: `ui/src/status.ts` (drop `Policy`, `SessionKind`, `describeSession` if nothing imports them — grep first; `policyRows` and `shortAddress` stay), `docs/superpowers/HANDOFF.md`, `CLAUDE.md` (one line under Commands: `pnpm dev:ui`)

- [ ] **Step 1: Delete, and make sure nothing misses them**

```bash
git rm ui/src/panel.tsx ui/src/swap-card.tsx ui/src/wallets.ts ui/src/wallets.test.ts
```

Then `pnpm typecheck` — anything that still imported them fails here. Fix the import, never restore the file.

- [ ] **Step 2: HANDOFF.md**

Rewrite the "Read this first" and "What that leaves" sections to describe three plans: the wallet panel (complete), the buttons-and-swap-card plan (built, then **superseded**), and this one. Carry forward, from the spec: one tool `open_fibx` bound to one document; every other tool headless; the dev host and how to run it (`pnpm dev:ui`, `pnpm dev:ui:bridge`); that a Swap in live mode is real; the byte guard and the current number; and that Task 10 manual verification is outstanding. Keep the Landmines section and add: _the machine in `ui/src/machine.ts` is the only place the swap flow's transitions live; a control's `disabled` expression must derive from `isLocked`/`canSwap`, never from ad-hoc state_.

- [ ] **Step 3: Measure and commit**

```bash
pnpm test && pnpm typecheck && ./node_modules/.bin/eslint src/ && ./node_modules/.bin/prettier --check src/ ui/ docs/superpowers/HANDOFF.md
```

```bash
pnpm build && node -e "const fs=require('fs');console.log(Buffer.byteLength(fs.readFileSync('ui/dist/index.html','utf8')), 'bytes')"
```

```bash
git add -A && git commit -m "chore: remove the two old surfaces; handoff describes the app (<N> bytes)"
```

---

### Task 10: Manual verification

**Files:** none. A human, a real wallet, Claude Desktop.

- [ ] **Step 1: Build, restart**

```bash
pnpm build
```

Quit Claude Desktop with Cmd+Q and reopen it — the MCP server starts with the app.

- [ ] **Step 2: The model reaches for the app**

Type, in three separate messages: _cüzdan durumum ne?_ — _0.0005 ETH ile ne kadar USDC alırım?_ — _ETH'yi USDC'ye çevirmek istiyorum_. Each should produce **the same whole app**, the second pre-filled with a quote, the third with the pair and an empty amount. If any produces prose from `get_quote` instead, note the exact message — that is the steering risk the spec names.

- [ ] **Step 3: The buttons**

In the app's pairing view: **Copy link** says _Copied_ and the clipboard holds a `wc:` URI, **or** it turns into the clipboard sentence. **Open in your wallet** opens a wallet, **or** it turns into the wallet-links sentence. A button that stays and does nothing is a fail — report it.

- [ ] **Step 4: Connect, and the model agrees**

Scan the QR. After connecting, the header shows the address, the balance appears under the source amount, and **the model's next sentence says the wallet is connected**.

- [ ] **Step 5: The form**

Pick USDC in the picker; type an amount above the balance — _Insufficient balance_ appears before any call, Simulate is disabled. Type one below — a quote arrives with a named route; Simulate works; Swap unlocks only after it.

- [ ] **Step 6: A real swap, small**

Swap an amount you are willing to lose. The wallet prompts; the widget follows the hash to _settled_; the explorer link opens; **the model's next turn says settled, not "swapped X for Y" as fact**.

- [ ] **Step 7: The policy still binds**

Expand _Signing policy_, set `base.maxValue` to `0.00001`, swap again — refused, the section opens itself, the rule is named. Remove the rule.

- [ ] **Step 8: Record**

```bash
git commit --allow-empty -m "chore: verify the app by hand on a real wallet"
```

---

## Out of scope — do not do these here

- Aave, transfers, portfolio in the widget.
- Token logos (`image_url` needs `_meta.ui.csp.resourceDomains`).
- Favourites, categories, custom recipient, batch swaps.
- Adding a chain.
- Detecting the host's UI capability at `initialize` to adjust tool descriptions per host — a separate spike if Step 2 of Task 10 shows the model reaching for `get_quote`.
- The two pre-existing `prettier --check` failures under `docs/superpowers/` (the 2026-08-29 WalletConnect files) — outside this work.
