# Panel Buttons and Swap Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the wallet panel's buttons do what they say, dress it in Fibrous's own visual language, and surface the aggregator's route in a swap card that can quote, simulate and swap from chat.

**Architecture:** Two `ui://` resources built from one Vite project so the SDK's schema layer is paid for once. `get_quote` keeps its prose and gains structured data drawn from the Fibrous route response it already fetches. The card binds to `get_quote` (read-only, so its appearance changes nothing) and calls `swap_tokens` only from a click.

**Tech Stack:** Preact, Vite + `vite-plugin-singlefile`, `@modelcontextprotocol/ext-apps` 1.7.5, `@modelcontextprotocol/sdk`, tsup, vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-panel-buttons-and-swap-card-design.md`

## Global Constraints

- **`dependencies` in `package.json` must stay absent.** New packages go in `devDependencies` only. This plan adds none.
- Code style: tabs for indentation, double quotes, semicolons.
- ESM: imports carry `.js` extensions even for TypeScript sources, including inside `ui/`. No `require()` in source.
- Tests are vitest, colocated as `<name>.test.ts` beside the source.
- **Never let a test touch the real config directory.** `policyPath()` and `sessionPath()` resolve to the actual `~/Library/Preferences/fibx-nodejs`, and `env-paths` ignores `XDG_CONFIG_HOME` on macOS. Mock `../../lib/config.js` or the module outright, the way `src/services/policy/store.test.ts` does.
- **A button that silently does nothing is worse than no button.** Every capability this plan touches is feature-detected, and when the capability is absent the control is not rendered.
- **No tool call without a click,** except the read-only reads a card makes to render itself: `get_auth_status`, `get_balance`, `get_policy`, `get_quote`. Every writer — `connect_wallet`, `logout`, `set_policy_rule`, `clear_policy_rule`, `swap_tokens` — runs only from a user gesture.
- **A cosmetic lookup must never fail a quote.** Protocol display names are decoration; the route, the amounts and the swap work without them.
- `pnpm test` runs `typecheck:ui` and `build:ui` first, so it is the full gate. `eslint` covers `src/` only; `pnpm typecheck` covers both tsconfigs.

## File Structure

**Create:**

- `src/services/fibrous/protocols.ts` — `getProtocols(chain)`, cached, failure-tolerant
- `src/services/fibrous/protocols.test.ts`
- `ui/swap-card.html` — the second Vite entry
- `ui/src/swap-main.tsx` — the card's entry point
- `ui/src/swap-card.tsx` — the card component
- `ui/src/quote.ts` — pure helpers for the card (impact formatting, route labels)
- `ui/src/quote.test.ts`

**Modify:**

- `src/mcp/ui.ts` — declare `clipboardWrite`; register the swap card resource
- `src/mcp/ui.test.ts` — assert the permission and the second resource; size guard covers both
- `src/mcp/handlers/quote.ts` — structured fields beside the prose
- `src/mcp/handlers/quote.test.ts` — create if absent; pin the structured shape
- `src/mcp/tools/trade.ts` — `get_quote` gains `_meta.ui.resourceUri`; describe `priceImpact` as derived
- `ui/vite.config.ts` — two entries
- `ui/src/panel.tsx` — copy button, wallet link, Fibrous styling
- `ui/src/wallets.ts` + `wallets.test.ts` — one `wc:` link instead of three brand links
- `ui/src/tokens.css` — Fibrous palette and type
- `ui/src/main.tsx` — `updateModelContext` after connect and logout

---

### Task 1: The clipboard, and one wallet link instead of three

Two dead buttons, two different causes. Copy was never granted the clipboard; the brand shortcuts hand `openLink` a mobile universal link that resolves to a web page on desktop, so it "succeeds" and leads nowhere.

**Files:**

- Modify: `src/mcp/ui.ts`, `src/mcp/ui.test.ts`, `ui/src/wallets.ts`, `ui/src/wallets.test.ts`, `ui/src/panel.tsx`

**Interfaces:**

- Consumes: `McpUiAppResourceConfig._meta.ui.permissions` — verified to exist in `@modelcontextprotocol/ext-apps/dist/src/server/index.d.ts:91-105`, typed as `McpUiResourceMeta`, whose `permissions` accepts `{ camera?, microphone?, geolocation?, clipboardWrite? }`.
- Produces: `walletLink(uri)` replacing `walletLinks(uri)`.

- [ ] **Step 1: Write the failing test for the link**

Replace the body of `ui/src/wallets.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { walletLink } from "./wallets.js";

const URI = "wc:abc@2?relay-protocol=irn&symKey=deadbeef";

describe("walletLink", () => {
	// The three brand links were mobile universal links. openLink opens the
	// host's default browser, not an app, so on a desktop they resolved to a
	// "open this in your app" web page and reported success. A bare wc: URI is
	// what desktop wallets register as a protocol handler.
	it("hands over the pairing URI unchanged", () => {
		expect(walletLink(URI)).toBe(URI);
	});

	// Encoding it would break the scheme the OS dispatches on.
	it("does not percent-encode the scheme", () => {
		expect(walletLink(URI).startsWith("wc:")).toBe(true);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run ui/src/wallets.test.ts`
Expected: FAIL — `walletLink` is not exported.

- [ ] **Step 3: Replace the link builder**

`ui/src/wallets.ts`, whole file:

```typescript
/**
 * Same-device pairing. The three brand universal links this replaces were
 * mobile-only: `openLink` opens the host's default browser rather than an app,
 * so on a desktop they landed on a "open this in your app" page and reported
 * success — a dead end with no error to react to.
 *
 * A bare `wc:` URI is what desktop wallets register as a protocol handler. If
 * the host refuses a non-http scheme it answers `isError`, which the caller
 * uses to hide the button rather than leave it dead.
 */
export function walletLink(uri: string): string {
	return uri;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run ui/src/wallets.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Declare the clipboard permission**

`src/mcp/ui.ts`, in `registerWalletPanel`, replace the config argument:

```typescript
		{
			mimeType: RESOURCE_MIME_TYPE,
			// Hosts gate browser capabilities behind a declared permission and
			// build the iframe's `allow` attribute from it. Without this the
			// clipboard call rejects and a Copy button does nothing at all.
			// Declaring is necessary and not sufficient — the app still feature-
			// detects, because a host may refuse.
			_meta: { ui: { permissions: { clipboardWrite: {} } } },
		},
```

- [ ] **Step 6: Write the failing test for the declaration**

Append to `src/mcp/ui.test.ts`:

```typescript
// The clipboard is the one capability this panel asks for. A host builds
// the iframe's allow attribute from this declaration; without it, Copy is
// a button that silently does nothing.
it("asks the host for clipboard write", () => {
	const server = new McpServer({ name: "t", version: "0" });
	registerWalletPanel(server);

	const registered = (
		server as unknown as {
			_registeredResources: Record<string, { metadata?: Record<string, unknown> }>;
		}
	)._registeredResources[WALLET_PANEL_URI];

	expect(registered?.metadata?._meta).toEqual({
		ui: { permissions: { clipboardWrite: {} } },
	});
});
```

Add the imports the file needs: `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`, and `registerWalletPanel` beside the existing `WALLET_PANEL_URI` / `walletPanelHtml`.

This reads a private SDK field, the same trade-off already recorded for `src/mcp/tools/annotations.test.ts`: there is no public lookup for a registered resource, and the field breaking on an SDK bump is the failure mode we want. If the shape differs from the guess above, read it from the installed SDK and adapt — do not delete the test.

- [ ] **Step 7: Run it**

Run: `pnpm exec vitest run src/mcp/ui.test.ts`
Expected: PASS, 4 tests. If the private field is named differently, fix the test's accessor, not the assertion.

- [ ] **Step 8: Make the copy button honest**

In `ui/src/panel.tsx`'s `Disconnected`, replace the `copyUri` helper and the copy control. Add state `const [copied, setCopied] = useState(false);` and `const canCopy = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.writeText);` beside the existing `linksAllowed`.

```tsx
async function copyUri(uri: string) {
	try {
		await navigator.clipboard.writeText(uri);
		if (!alive.current) return;
		setCopied(true);
		setTimeout(() => alive.current && setCopied(false), 1500);
	} catch {
		// The host refused despite the declaration. Retire the button
		// rather than leave one that does nothing; the URI is selectable.
		if (alive.current) setCanCopyFalse();
	}
}
```

Hold the detection in state so the catch can retire it: `const [canCopy, setCanCopy] = useState(() => typeof navigator !== "undefined" && Boolean(navigator.clipboard?.writeText));` and let `setCanCopyFalse` be `() => setCanCopy(false)`, or inline `setCanCopy(false)`.

Render the button only when `canCopy`:

```tsx
{
	canCopy && (
		<button class="ghost" onClick={() => copyUri(pairing.uri)}>
			{copied ? "Copied" : "Copy link"}
		</button>
	);
}
```

- [ ] **Step 9: Replace the three shortcuts with one**

In the same waiting/expired card, replace the `walletLinks(...).map(...)` block:

```tsx
{
	linksAllowed && (
		<button
			class="ghost"
			onClick={async () => {
				const r = await app.openLink({ url: walletLink(pairing.uri) });
				// A refusal is a result, not an exception. If the host
				// will not dispatch a wc: URI, retire the button — the
				// QR and the copyable URI both still work.
				if (r.isError && alive.current) setLinksAllowed(false);
			}}
		>
			Open in your wallet
		</button>
	);
}
```

Update the import to `walletLink`.

- [ ] **Step 10: Verify**

```bash
pnpm test && pnpm typecheck && ./node_modules/.bin/eslint src/ && ./node_modules/.bin/prettier --check src/ ui/
```

Expected: clean. Test count rises by 1 (the permission test); `wallets.test.ts` goes from 1 test to 2.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "fix: ask for the clipboard, and hand the wallet a URI it can open"
```

---

### Task 2: Fibrous's own visual language

The panel is legible but generic. Bring it to the palette and type the product already uses, and to the section rhythm of `fibrous-interface/components/confirm-swap`, whose modal orders _details → recipient → min received → action_.

**Files:** Modify `ui/src/tokens.css`

**Interfaces:** none — CSS only. Class names already used by `panel.tsx` (`.card`, `.row`, `.pill`, `.mono`, `.muted`, `button.ghost`, `input.mono`, `.qr`, `textarea.uri`, `table`) must keep working; this task restyles them and adds none.

- [ ] **Step 1: Align the tokens with the product**

The current values were lifted correctly. Confirm them against `fibrous-interface/styles/globals.css` and correct any drift: light `--bg-primary: 247 248 248`, `--bg-secondary: 255 255 255`, `--text-primary: 39 45 62`; dark `--bg-primary: 27 31 44`, `--bg-secondary: 39 45 62`, `--text-primary: 255 255 255`; brand `--brand-primary: 17 178 186` in both.

Note the light-mode text token differs from what `tokens.css` currently carries — the product uses `39 45 62`, a blue-slate, not a near-black.

- [ ] **Step 2: Give the panel the product's rhythm**

Raise the card padding to `16px`, gap to `12px`, and radius to `12px` to match the modal's `gap-5 p-5` proportions at the panel's smaller scale. Give `.card + .card` a `10px` top margin so stacked cards read as sections rather than one slab.

- [ ] **Step 3: Fix the button hierarchy**

One primary action per card, brand-filled; everything else `ghost`. Add a `button.danger` for the whole-policy wipe using `--status-error`, since "Remove whole policy" currently carries the same weight as "Copy link".

```css
button.danger {
	background: rgb(var(--status-error) / 0.15);
	color: rgb(var(--status-error));
}

button.danger:hover {
	background: rgb(var(--status-error) / 0.25);
}
```

Apply `class="ghost danger"` to that button in `panel.tsx`.

- [ ] **Step 4: Numbers get the numeral face**

Every amount, address and rule value already carries `.mono`, which maps to `--font-rubik`. Confirm `font-variant-numeric: tabular-nums` is on `.mono` and on `td`, so columns line up.

- [ ] **Step 5: Verify and commit**

```bash
pnpm build && pnpm test && pnpm typecheck && ./node_modules/.bin/prettier --check src/ ui/
```

```bash
git add -A && git commit -m "style: dress the panel in Fibrous's palette and rhythm"
```

---

### Task 3: Protocol names for the route

`swap_parameters[].protocol_id` is a number. Fibrous serves the mapping at the same graph host the token list already comes from.

**Files:**

- Create: `src/services/fibrous/protocols.ts`, `src/services/fibrous/protocols.test.ts`

**Interfaces:**

- Consumes: `FIBROUS_GRAPH_URL` from `../../lib/config.js`; `readCache` / `writeCache` from `../../lib/cache.js` (`readCache<T>(key, ttlMs = TOKEN_CACHE_TTL_MS)`); `fetchWithTimeout(url, { timeoutMs })` from `../../lib/fetch.js`; `ChainConfig.fibrousNetwork`.
- Produces: `getProtocolNames(chain): Promise<Map<number, string>>` — **never rejects**.

`writeCache` resolves through `paths.cache` to the developer's real cache directory, so the test mocks `../../lib/cache.js` outright rather than letting a real write happen. `fetchWithTimeout` is mocked for the same reason a real `fetch` would be: no test may reach the network.

- [ ] **Step 1: Write the failing test**

`src/services/fibrous/protocols.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

// readCache/writeCache resolve through paths.cache to the developer's real
// cache directory, and fetchWithTimeout would reach the network. Both are
// mocked so this test touches neither.
const mocks = vi.hoisted(() => ({
	readCache: vi.fn(),
	writeCache: vi.fn(),
	fetchWithTimeout: vi.fn(),
}));

vi.mock("../../lib/cache.js", () => ({
	readCache: mocks.readCache,
	writeCache: mocks.writeCache,
}));
vi.mock("../../lib/fetch.js", () => ({ fetchWithTimeout: mocks.fetchWithTimeout }));

const { getProtocolNames } = await import("./protocols.js");

const chain = { fibrousNetwork: "base" } as never;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.readCache.mockReturnValue(null);
});

describe("getProtocolNames", () => {
	it("maps protocol ids to display names", async () => {
		mocks.fetchWithTimeout.mockResolvedValue({
			ok: true,
			json: async () => [
				{ protocol: 1, display_name: "Uniswap V3" },
				{ protocol: 4, display_name: "Aerodrome" },
			],
		});

		const names = await getProtocolNames(chain);

		expect(names.get(1)).toBe("Uniswap V3");
		expect(names.get(4)).toBe("Aerodrome");
	});

	// This lookup is decoration. A quote that failed because a name could not
	// be fetched would be a swap the user cannot make for a cosmetic reason.
	it("returns an empty map when the endpoint fails, rather than throwing", async () => {
		mocks.fetchWithTimeout.mockResolvedValue({ ok: false, status: 503 });

		await expect(getProtocolNames(chain)).resolves.toEqual(new Map());
	});

	it("returns an empty map when the fetch itself rejects", async () => {
		mocks.fetchWithTimeout.mockRejectedValue(new Error("offline"));

		await expect(getProtocolNames(chain)).resolves.toEqual(new Map());
	});

	// A timeout is the case that matters most: this call runs in parallel with
	// the route fetch, so a hanging endpoint would hold the quote open.
	it("returns an empty map when the request aborts", async () => {
		mocks.fetchWithTimeout.mockRejectedValue(
			Object.assign(new Error("aborted"), { name: "AbortError" })
		);

		await expect(getProtocolNames(chain)).resolves.toEqual(new Map());
	});

	it("serves a cached list without fetching", async () => {
		mocks.readCache.mockReturnValue([{ protocol: 9, display_name: "Cached DEX" }]);

		const names = await getProtocolNames(chain);

		expect(names.get(9)).toBe("Cached DEX");
		expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/services/fibrous/protocols.test.ts`
Expected: FAIL — `./protocols.js` does not exist.

- [ ] **Step 3: Write it**

`src/services/fibrous/protocols.ts`:

```typescript
import { FIBROUS_GRAPH_URL } from "../../lib/config.js";
import { readCache, writeCache } from "../../lib/cache.js";
import { fetchWithTimeout } from "../../lib/fetch.js";
import type { ChainConfig } from "../chain/constants.js";

interface LiquiditySource {
	protocol: number;
	display_name: string;
	amm_name?: string;
	image_url?: string | null;
}

/**
 * Maps Fibrous protocol ids to the names a person recognises, from the same
 * endpoint fibrous-interface uses.
 *
 * It never rejects. These names are decoration on a route the user can swap
 * through either way, and a quote that failed because a cosmetic lookup failed
 * would be the worse outcome by a wide margin.
 *
 * No `withRetry` here, and a shorter timeout than the 15s default: this runs
 * in parallel with the route fetch, so every second it spends failing is a
 * second the quote is not ready. Retrying a decoration would invert that.
 */
export async function getProtocolNames(chain: ChainConfig): Promise<Map<number, string>> {
	const cacheKey = `protocols-${chain.fibrousNetwork}`;
	const cached = readCache<LiquiditySource[]>(cacheKey);
	if (cached) return toMap(cached);

	try {
		const res = await fetchWithTimeout(
			`${FIBROUS_GRAPH_URL}/${chain.fibrousNetwork}/protocols`,
			{
				timeoutMs: 5_000,
			}
		);
		if (!res.ok) return new Map();

		const sources = (await res.json()) as LiquiditySource[];
		if (!Array.isArray(sources)) return new Map();

		writeCache(cacheKey, sources);
		return toMap(sources);
	} catch {
		return new Map();
	}
}

function toMap(sources: LiquiditySource[]): Map<number, string> {
	const names = new Map<number, string>();
	for (const s of sources) {
		if (typeof s?.protocol === "number" && s.display_name) {
			names.set(s.protocol, s.display_name);
		}
	}
	return names;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run src/services/fibrous/protocols.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test && pnpm typecheck && ./node_modules/.bin/eslint src/
```

```bash
git add -A && git commit -m "feat: resolve Fibrous protocol ids to names, without ever failing a quote"
```

---

### Task 4: `get_quote` returns the route it already fetched

The prose stays — the model reads it. The data a card needs goes beside it.

**Files:**

- Modify: `src/mcp/handlers/quote.ts`, `src/mcp/tools/trade.ts`
- Create: `src/mcp/handlers/quote.test.ts`

**Interfaces:**

- Consumes: `getRouteAndCallData` → `{ route: { inputToken, outputToken, inputAmount, outputAmount }, calldata: { route: { min_received, … }, swap_parameters: [{ protocol_id, pool_address, rate, … }] }, router_address }`. `RouteToken` carries `symbol`, `decimals` and `price` (USD). `getProtocolNames` from Task 3.
- Produces: the quote result gains `quote: { … }` — a nested object, so nothing existing moves.

- [ ] **Step 1: Write the failing test**

`src/mcp/handlers/quote.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
	getRouteAndCallData: vi.fn(),
	getProtocolNames: vi.fn(),
	resolveToken: vi.fn(),
}));

vi.mock("../../services/fibrous/route.js", () => ({
	getRouteAndCallData: mocks.getRouteAndCallData,
}));
vi.mock("../../services/fibrous/protocols.js", () => ({
	getProtocolNames: mocks.getProtocolNames,
}));
vi.mock("../../services/fibrous/tokens.js", () => ({ resolveToken: mocks.resolveToken }));

const { handleGetQuote } = await import("./quote.js");

function parse(result: { content: { type: string; text: string }[] }) {
	return JSON.parse(result.content[0].text) as Record<string, never>;
}

const ETH = { symbol: "ETH", address: "0xEeee", decimals: 18 };
const USDC = { symbol: "USDC", address: "0x8335", decimals: 6 };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolveToken.mockImplementation(async (s: string) => (s === "ETH" ? ETH : USDC));
	mocks.getProtocolNames.mockResolvedValue(new Map([[1, "Uniswap V3"]]));
	// RouteToken is { name, address, decimals, price } — it carries no `symbol`.
	// Symbols come from resolveToken; only the prices are read off the route.
	mocks.getRouteAndCallData.mockResolvedValue({
		route: {
			inputToken: { name: "Ether", address: ETH.address, decimals: 18, price: 4000 },
			outputToken: { name: "USD Coin", address: USDC.address, decimals: 6, price: 1 },
			inputAmount: "1000000000000000000",
			outputAmount: "3960000000",
		},
		calldata: {
			route: { min_received: "3920400000" },
			swap_parameters: [
				{ protocol_id: "1", pool_address: "0xpool1" },
				{ protocol_id: "7", pool_address: "0xpool2" },
			],
		},
		router_address: "0xrouter",
	});
});

describe("get_quote's structured half", () => {
	// The prose is what the model reads; removing it would degrade every
	// text-only host. The data is what a card draws.
	it("keeps the prose fields", async () => {
		const out = parse(
			await handleGetQuote({
				amount: "1",
				from_token: "ETH",
				to_token: "USDC",
				chain: "base",
				slippage: 0.5,
			})
		);

		expect(out.input).toBe("1 ETH");
		expect(typeof out.rate).toBe("string");
	});

	it("returns the exact output and the slippage floor", async () => {
		const q = parse(
			await handleGetQuote({
				amount: "1",
				from_token: "ETH",
				to_token: "USDC",
				chain: "base",
				slippage: 0.5,
			})
		).quote as never as Record<string, unknown>;

		expect(q.outputAmount).toBe("3960");
		expect(q.minReceived).toBe("3920.4");
	});

	// 1 ETH at $4000 in, 3960 USDC at $1 out — one percent of value lost.
	it("derives price impact from the prices the route already carries", async () => {
		const q = parse(
			await handleGetQuote({
				amount: "1",
				from_token: "ETH",
				to_token: "USDC",
				chain: "base",
				slippage: 0.5,
			})
		).quote as never as Record<string, number>;

		expect(q.usdIn).toBeCloseTo(4000, 6);
		expect(q.usdOut).toBeCloseTo(3960, 6);
		expect(q.priceImpact).toBeCloseTo(1, 6);
	});

	it("names the hops it can and keeps the pool for the ones it cannot", async () => {
		const q = parse(
			await handleGetQuote({
				amount: "1",
				from_token: "ETH",
				to_token: "USDC",
				chain: "base",
				slippage: 0.5,
			})
		).quote as never as {
			route: { protocol: number; displayName?: string; pool: string }[];
		};

		expect(q.route).toEqual([
			{ protocol: 1, displayName: "Uniswap V3", pool: "0xpool1" },
			{ protocol: 7, pool: "0xpool2" },
		]);
	});

	// The names are decoration; the quote is the product.
	it("still quotes when the protocol lookup returns nothing", async () => {
		mocks.getProtocolNames.mockResolvedValue(new Map());

		const q = parse(
			await handleGetQuote({
				amount: "1",
				from_token: "ETH",
				to_token: "USDC",
				chain: "base",
				slippage: 0.5,
			})
		).quote as never as {
			route: { displayName?: string }[];
		};

		expect(q.route).toHaveLength(2);
		expect(q.route[0].displayName).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/mcp/handlers/quote.test.ts`
Expected: FAIL — `out.quote` is undefined.

- [ ] **Step 3: Add the structured half**

In `src/mcp/handlers/quote.ts`, import `getProtocolNames` from `../../services/fibrous/protocols.js`, and fetch it alongside the route:

```typescript
const [routeData, protocolNames] = await Promise.all([
	getRouteAndCallData(
		{
			amount: amountBaseUnits.toString(),
			tokenInAddress: tokenIn.address,
			tokenOutAddress: tokenOut.address,
			slippage: slippage ?? DEFAULT_SLIPPAGE,
			destination: QUOTE_DESTINATION,
		},
		chainConfig
	),
	getProtocolNames(chainConfig),
]);
```

Then, after `outputAmount` is computed, build the structured half and return it beside the prose:

```typescript
const minReceived = formatAmount(BigInt(routeData.calldata.route.min_received), tokenOut.decimals);

// Both USD prices come back with the route. Price impact is the value lost
// between them — our derivation, not a number Fibrous returns, and computed
// from spot prices rather than the pool's marginal price, so it is an
// estimate.
const usdIn = parseFloat(amount) * (routeData.route.inputToken.price ?? 0);
const usdOut = parseFloat(outputAmount) * (routeData.route.outputToken.price ?? 0);
const priceImpact = usdIn > 0 ? ((usdIn - usdOut) / usdIn) * 100 : 0;

const route = routeData.calldata.swap_parameters.map((sp) => {
	const protocol = Number(sp.protocol_id);
	const displayName = protocolNames.get(protocol);
	return displayName
		? { protocol, displayName, pool: sp.pool_address }
		: { protocol, pool: sp.pool_address };
});

return jsonResult({
	input: `${amount} ${tokenIn.symbol}`,
	output: `~${outputAmount} ${tokenOut.symbol}`,
	rate: `1 ${tokenIn.symbol} ≈ ${rate} ${tokenOut.symbol}`,
	slippage: `${slippage ?? DEFAULT_SLIPPAGE}%`,
	router: routeData.router_address,
	chain: chainConfig.name,
	// Everything a card needs to draw the route, nested so no existing
	// field moves and no text-only caller notices.
	quote: {
		fromToken: tokenIn.symbol,
		toToken: tokenOut.symbol,
		inputAmount: amount,
		outputAmount,
		minReceived,
		slippage: slippage ?? DEFAULT_SLIPPAGE,
		usdIn,
		usdOut,
		priceImpact,
		route,
		routerAddress: routeData.router_address,
		chain: chainConfig.name,
	},
});
```

The wrap and unwrap branches return early and gain nothing — they have no route, and a 1:1 conversion has no impact to show. Leave them exactly as they are.

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run src/mcp/handlers/quote.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Say in the tool description that impact is derived**

In `src/mcp/tools/trade.ts`, extend `get_quote`'s description with one sentence:

```
Returns both a readable summary and a `quote` object carrying the route's hops, the exact output, the slippage floor and a derived price impact — computed from the tokens' spot prices, not reported by the router, so treat it as an estimate.
```

Leave the annotations untouched: `readOnlyHint: true` is what lets a card bind to this tool without its appearance doing anything.

- [ ] **Step 6: Verify and commit**

```bash
pnpm test && pnpm typecheck && ./node_modules/.bin/eslint src/ && ./node_modules/.bin/prettier --check src/
```

```bash
git add -A && git commit -m "feat: return the route get_quote already fetches"
```

---

### Task 5: Two entries, one bundle's worth of SDK

**This task is a gate.** The panel is 352 KB against a 400 KB guard, and nearly all of it is the SDK schema layer `App` pulls in. If a second entry duplicates that, the pair blows the budget and the card is the wrong shape before a line of it is written. Measure first.

**Files:**

- Create: `ui/swap-card.html`, `ui/src/swap-main.tsx` (a stub)
- Modify: `ui/vite.config.ts`, `src/mcp/ui.ts`, `src/mcp/ui.test.ts`

**Interfaces:**

- Produces: `SWAP_CARD_URI`, `swapCardHtml`, and `registerSwapCard(server)` from `src/mcp/ui.ts`.

- [ ] **Step 1: Add the second entry**

`ui/swap-card.html`:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<title>FibX Swap</title>
	</head>
	<body>
		<div id="root"></div>
		<script type="module" src="/src/swap-main.tsx"></script>
	</body>
</html>
```

`ui/src/swap-main.tsx` — a stub for this task, replaced in Task 6:

```tsx
import { render } from "preact";
import "./tokens.css";

render(<div data-fibx-swap-card>FibX Swap</div>, document.getElementById("root")!);
```

- [ ] **Step 2: Teach Vite about both**

`ui/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

export default defineConfig({
	root: "ui",
	plugins: [viteSingleFile()],
	esbuild: { jsx: "automatic", jsxImportSource: "preact" },
	build: {
		outDir: "dist",
		emptyOutDir: true,
		rollupOptions: {
			input: {
				panel: resolve("ui/index.html"),
				swap: resolve("ui/swap-card.html"),
			},
		},
	},
});
```

- [ ] **Step 3: Build and measure — this is the gate**

```bash
pnpm build:ui
```

```bash
ls -l ui/dist/index.html ui/dist/swap-card.html
```

`vite-plugin-singlefile` inlines everything into each document, so the two files are independent and each carries its own copy of whatever it imports. Record both sizes.

- **If the stub card is small** (tens of KB — it imports no SDK yet), the plugin is behaving and Task 6 must watch the number as `App` arrives.
- **If the pair together approaches or exceeds 400 KB once Task 6 adds `App`,** the design changes: the two documents share one bundle only if they share one entry. The fallback is a single HTML that switches on the tool result it receives, registered under both URIs. Do not invent a third option; take this one and say so in the report.

- [ ] **Step 4: Register the second resource**

In `src/mcp/ui.ts`:

```typescript
import swapCardHtmlRaw from "../../ui/dist/swap-card.html";

export const SWAP_CARD_URI = "ui://fibx/swap-card.html";

/** The built swap card, as the host will receive it. Exported for tests. */
export const swapCardHtml: string = swapCardHtmlRaw;

export function registerSwapCard(server: McpServer): void {
	registerAppResource(
		server,
		SWAP_CARD_URI,
		SWAP_CARD_URI,
		// No permissions: the card copies nothing and opens nothing.
		{ mimeType: RESOURCE_MIME_TYPE },
		async () => ({
			contents: [{ uri: SWAP_CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: swapCardHtml }],
		})
	);
}
```

Call `registerSwapCard(server)` beside `registerWalletPanel(server)` in `src/mcp/server.ts`.

- [ ] **Step 5: Extend the size guard to the pair**

In `src/mcp/ui.test.ts`, add `SWAP_CARD_URI` and `swapCardHtml` to the import from `./ui.js`, then add two assertions:

```typescript
// The panel's own inlining test, for the second document. It proves the
// vitest html-as-text loader inlined a built file rather than a path.
it("carries the built swap card, inlined", () => {
	expect(swapCardHtml).toContain("data-fibx-swap-card");
	expect(swapCardHtml).not.toMatch(/<script[^>]+src=/);
});

// Both documents are inlined into the server bundle that every fibx
// invocation loads and npx downloads. The SDK's schema layer sets the floor;
// the ceiling is what stops an accidental import from doubling it.
it("keeps both inlined documents inside the budget", () => {
	expect(walletPanelHtml.length + swapCardHtml.length).toBeLessThan(800_000);
});
```

Keep the existing per-panel 400 KB assertion. Two guards, two failure modes: one catches the panel growing, the other catches the pair.

Task 6 replaces the stub with a real card, so `data-fibx-swap-card` must survive onto the card's own root element — it is what this test recognises.

- [ ] **Step 6: Verify and commit**

```bash
pnpm build && pnpm test && pnpm typecheck
```

```bash
git add -A && git commit -m "build: a second ui:// entry, measured before it is filled"
```

---

### Task 6: The swap card

**Only start this once Task 5's measurement is recorded.**

**Files:**

- Create: `ui/src/quote.ts`, `ui/src/quote.test.ts`, `ui/src/swap-card.tsx`
- Modify: `ui/src/swap-main.tsx`, `src/mcp/tools/trade.ts`, `ui/src/tokens.css`

**Interfaces:**

- Consumes: `get_quote` → the `quote` object from Task 4; `swap_tokens({ amount, from_token, to_token, chain, slippage, simulate })` → simulate returns `{ success, mode, amountIn, amountOut, tokenIn, tokenOut, router, chain, requiresApproval? }`, a broadcast returns `{ txHash, amountIn, amountOut, tokenIn, tokenOut, router, chain, explorer }`; `get_tx_status({ hash, chain })` → `{ status: "confirmed" | "reverted", blockNumber, explorer }`. `callJson` from `./rpc.js` throws on both `isError` and `{ success: false }` bodies.
- Produces: `formatImpact`, `routeLabel` from `quote.ts`.

- [ ] **Step 1: Write the failing tests for the pure part**

`ui/src/quote.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { formatImpact, routeLabel } from "./quote.js";

describe("formatImpact", () => {
	it("reads a small loss as ordinary", () => {
		expect(formatImpact(0.3)).toEqual({ text: "0.30%", severity: "ok" });
	});

	// Past a point the number stops being trivia and becomes the reason not to
	// swap, so it has to look different.
	it("warns past one percent", () => {
		expect(formatImpact(1.4).severity).toBe("warn");
	});

	it("alarms past five", () => {
		expect(formatImpact(7.2).severity).toBe("bad");
	});

	// A route can price better than spot; showing "-0.10%" as a loss would be
	// backwards.
	it("keeps a negative impact negative", () => {
		expect(formatImpact(-0.1).text).toBe("-0.10%");
	});
});

describe("routeLabel", () => {
	it("prefers the protocol's name", () => {
		expect(routeLabel({ protocol: 1, displayName: "Uniswap V3", pool: "0xabcdef1234" })).toBe(
			"Uniswap V3"
		);
	});

	// Without a name the pool is the only honest identifier, shortened so a
	// row of hops still fits.
	it("falls back to a shortened pool address", () => {
		expect(routeLabel({ protocol: 7, pool: "0xabcdef1234567890" })).toBe("0xabcd…7890");
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run ui/src/quote.test.ts`
Expected: FAIL — `./quote.js` does not exist.

- [ ] **Step 3: Write the helpers**

`ui/src/quote.ts`:

```typescript
export type Hop = { protocol: number; displayName?: string; pool: string };

export type Quote = {
	fromToken: string;
	toToken: string;
	inputAmount: string;
	outputAmount: string;
	minReceived: string;
	slippage: number;
	usdIn: number;
	usdOut: number;
	priceImpact: number;
	route: Hop[];
	routerAddress: string;
	chain: string;
};

export type Severity = "ok" | "warn" | "bad";

/**
 * Price impact is an estimate derived from spot prices, so the thresholds are
 * about attention rather than precision: past one percent it is worth reading,
 * past five it is worth stopping for.
 */
export function formatImpact(impact: number): { text: string; severity: Severity } {
	const severity: Severity = impact >= 5 ? "bad" : impact >= 1 ? "warn" : "ok";
	return { text: `${impact.toFixed(2)}%`, severity };
}

export function routeLabel(hop: Hop): string {
	if (hop.displayName) return hop.displayName;
	return `${hop.pool.slice(0, 6)}…${hop.pool.slice(-4)}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run ui/src/quote.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Bind the card to `get_quote`**

In `src/mcp/tools/trade.ts`, convert `get_quote` from `server.registerTool` to `registerAppTool` (imported from `@modelcontextprotocol/ext-apps/server`), adding one field beside the untouched annotations:

```typescript
			_meta: { ui: { resourceUri: SWAP_CARD_URI } },
```

Import `SWAP_CARD_URI` from `../ui.js`. Do not touch `swap_tokens`' registration — a card must never be bound to a tool that moves money by appearing.

- [ ] **Step 6: Write the card**

`ui/src/swap-card.tsx`, rendering, in the order `fibrous-interface`'s confirm modal uses — details, then the floor, then the action:

- **You Pay** — `inputAmount fromToken`, with `usdIn` beneath
- **You Receive** — `outputAmount toToken`, with `usdOut` beneath
- a row carrying the rate and the impact, the latter styled by `formatImpact`'s severity
- **Route** — the hops as pills via `routeLabel`, in order
- **Min received** — `minReceived toToken`, with the slippage that produced it in an input; changing it re-calls `get_quote` with the new value
- **Simulate** and **Swap**

State machine: `idle → simulating → simulated → swapping → broadcast → confirmed | reverted | failed`. Both buttons disable while any call is in flight. `Simulate` calls `swap_tokens` with `simulate: true`; when the result carries `requiresApproval`, say plainly that the swap will take two transactions and two wallet approvals. `Swap` calls `swap_tokens` without it, then polls `get_tx_status` with the returned hash — reuse `nextPoll` from `./status.js` for the ceiling rather than writing a second loop — and shows the explorer link the handler returns.

Lifecycle: the card takes the same `alive` ref pattern `Disconnected` uses, checked after every `await` before any state set.

- [ ] **Step 7: Tell the model what happened**

After a broadcast returns a hash, call `app.updateModelContext` with a sentence naming the swap and the hash. MCP Apps do not push UI state to the model; during the panel's manual verification the model's prose contradicted the widget for exactly this reason.

- [ ] **Step 8: Replace the stub**

`ui/src/swap-main.tsx` mirrors `main.tsx`: construct `App`, `addEventListener("toolresult", …)` to receive the `get_quote` result, `app.connect()` with both `.then` and `.catch` reaching visible state, a `useEffect` cleanup calling `app.close()`, and the dark-class toggle from `prefers-color-scheme`.

- [ ] **Step 9: Verify, and check the budget again**

```bash
pnpm build && pnpm test && pnpm typecheck && ./node_modules/.bin/eslint src/ && ./node_modules/.bin/prettier --check src/ ui/
```

```bash
ls -l ui/dist/index.html ui/dist/swap-card.html
```

Record both sizes in the commit message. If the pair guard fails, Task 5's fallback applies.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: a swap card that shows the route it is swapping through"
```

---

### Task 7: The panel tells the model what it did

**Files:** Modify `ui/src/panel.tsx`

- [ ] **Step 1: After a connect and after a logout**

In `Panel`'s `refreshAuth`, once the fetch succeeds, call `app.updateModelContext` with one sentence naming the state — connected with the address, or no wallet connected. The model's next turn then matches the panel instead of contradicting it.

- [ ] **Step 2: Verify and commit**

```bash
pnpm build && pnpm test && pnpm typecheck
```

```bash
git add -A && git commit -m "fix: let the model learn what the panel did"
```

---

### Task 8: Manual verification

No automated test proves a card renders in a real host, and none of this plan's central claims — that the clipboard now works, that a `wc:` link reaches a wallet, that a swap goes through — can be checked without a person and a funded wallet.

**Files:** none

- [ ] **Step 1: Build and reload**

```bash
pnpm build
```

Quit Claude Desktop entirely and reopen it, so the running `fibx-dev` process picks up the new build.

- [ ] **Step 2: The clipboard**

Log out, ask for wallet status, press **Copy link** on the pairing card. Expected: the label becomes **Copied**, and pasting elsewhere yields the `wc:` URI. If the button is absent, the host refused the permission — say so, that is the designed fallback and not a failure.

- [ ] **Step 3: The wallet link**

Press **Open in your wallet**. Expected: a wallet opens with the pairing loaded, **or** the button disappears because the host refused a `wc:` URI. Either is a pass. A button that stays and does nothing is a fail — report it.

- [ ] **Step 4: A quote card**

Ask for a quote, e.g. "0.0001 ETH ile ne kadar USDC alırım?". Expected: a card with You Pay / You Receive, USD values, the rate, the price impact, and the route as named hops. Compare the route against the same pair on the Fibrous interface — the protocols should agree.

- [ ] **Step 5: Simulate**

Press **Simulate**. Expected: a preview with no transaction sent. On a token that needs an allowance, the card says the swap will take two transactions and two approvals.

- [ ] **Step 6: A real swap, small**

Press **Swap** on an amount you are willing to lose. Expected: the host prompts, the wallet prompts, the card follows the hash to confirmed, and the explorer link opens the transaction. Then check the model's next turn knows the swap happened.

- [ ] **Step 7: The policy still bounds it**

```bash
node dist/index.js policy set base.maxValue 0.00001
```

Swap again from the card. Expected: refused, naming the cap — the card is a surface over the same signing path, not a way around it. Then:

```bash
node dist/index.js policy clear --yes
```

- [ ] **Step 8: Commit the verification note**

```bash
git commit --allow-empty -m "chore: verify the buttons and the swap card by hand"
```

---

## Out of scope — do not do these here

- **Phase C**, a swap form inside the wallet panel. It needs a `list_tokens` tool that does not exist.
- Protocol logos. `image_url` is in the response but showing it needs `_meta.ui.csp.resourceDomains`.
- Component tests for `panel.tsx` or the card — still the standing follow-up, still needing a DOM environment.
- Any change to how the three signing paths work, or to `swap_tokens`' annotations.
- The deferred items already recorded in `HANDOFF.md`: the `FibxError` promotion, the SDK bump, `config_action`'s `isOffered()`, the bundle's SDK floor.
