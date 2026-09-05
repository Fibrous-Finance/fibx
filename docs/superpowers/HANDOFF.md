# Handoff — where the work stands

**Last updated:** 2026-09-05

This file exists so a new session can pick the work up without the previous
conversation. It is committed on purpose: the SDD ledger under `.superpowers/`
is gitignored scratch and dies with the worktree, so anything that must survive
lives here.

---

## Read this first

**Three plans have run on this branch, back to back.**

The first — the MCP Apps wallet panel — is **complete**. The gate passed on
2026-09-01 (Claude Desktop renders a `ui://` resource from a local stdio
server; `ext-apps` issue #671 does not apply here), and its Task 9, verifying
the finished panel by hand on a real wallet, passed on 2026-09-02.

The second — panel buttons and the swap card — was **built and reviewed**: it
fixed two dead buttons in the panel, restyled it, surfaced the Fibrous route
data `get_quote` was already fetching and discarding, and added a swap card in
chat with Simulate and Swap. It is now **superseded**. Its Task 8, verifying
the swap card by hand, was never run — instead of running it, this branch
replaced both chat surfaces with one application before anyone did. The panel
and the card no longer exist: `ui/src/panel.tsx` and `ui/src/swap-card.tsx`
are deleted, along with `ui/src/wallets.ts`, which had no importer left once
the panel was gone.

The third — the FibX app widget (spec
`docs/superpowers/specs/2026-09-05-fibx-app-widget-design.md`, plan
`docs/superpowers/plans/2026-09-05-fibx-app-widget.md`) — is what replaced
them, and this commit is its last task. **One tool, `open_fibx`, bound to one
document (`ui://fibx/app.html`).** Every other tool — `get_quote`,
`get_auth_status`, `get_balance`, `get_policy`, `swap_tokens` — stays
headless, exactly as the CLI and `fibx-telegram-bot` already call them.
`open_fibx` composes their handlers into one snapshot, so one turn produces
one widget instance, seeded consistently, rather than three tools each
drawing their own fragment of it. One new headless tool, `list_tokens`, feeds
the picker.

Why one document rather than a second `ui://` resource: `vite-plugin-singlefile`
inlines the `ext-apps` SDK's schema layer into whatever it builds, and a
second Vite entry pays for that layer a second time from scratch — measured,
on this same repo, at 340 KB for a stub that did nothing but import `App`.
One document behind two URIs (plan 1 and 2's shape) or, now, one URI (plan
3's) is the only way to pay for that layer once.

**What that leaves:**

1. **Task 10 of the third plan — manual verification — is outstanding.**
   Nobody has run the app against a real wallet in Claude Desktop. This
   supersedes plan 2's Task 8: there is no swap card left to verify by hand,
   and the steps that matter now are the app's — build, restart Claude
   Desktop, check that three different chat phrasings each open the same
   whole app, work the pairing buttons, run a real swap, and confirm the
   policy still refuses. The plan's Task 10 has the full steps. It is the
   gate on `npm publish`.
2. **Merge** — deliberately not done by an agent; a shared-branch side effect.
3. **`npm publish`** — built, tested, pushed, not released.

**The dev host** closes the "nobody could see it" gap the swap card shipped
without. `pnpm dev:ui` opens a local host against fixtures — every widget
state (connected, a quote, a simulate that needs an approval, a confirmed and
a reverted broadcast, an insufficient-funds error) is one click away, and its
_grant clipboardWrite_ and _accept wc:_ checkboxes reproduce Claude Desktop's
own refusals instead of guessing at them. `pnpm dev:ui:bridge` swaps the
fixtures for a real `fibx mcp-start` process over stdio — **a Swap there is a
real swap**, not a fixture.

`ui/` also has a DOM test environment now: `happy-dom`, loaded per file with a
`// @vitest-environment happy-dom` docblock, and `mount()`/`fakeApp()` in
`ui/src/test-utils.ts`. An earlier round of this work believed the
zero-dependency rule forbade a DOM testing library; it does not — the rule is
that `dependencies` in `package.json` stays empty, and `happy-dom` sits in
`devDependencies` beside vitest itself.

**The byte guard is 400,000 bytes, measured in bytes** (`Buffer.byteLength`),
never raised. The document is at **369,812 bytes** as of this commit.

**Before this worktree is removed:** `claude_desktop_config.json`'s
`mcpServers.fibx-dev` entry points at _this worktree's_ `dist/index.js`.
Merging and removing the worktree breaks it until that path is changed to the
main checkout and `pnpm build` is run there.

An earlier version of this file said the branch was "merge-ready at `930d6fc`".
That was true of the first plan and has not been true since: the second plan
added a money path, and the third replaced both its chat surfaces before
anyone verified either by hand.

A status page covering the first plan's ground, in a form that is easier to
hand to someone else: https://claude.ai/code/artifact/3f864c62-98bf-4579-b7d9-f4ba65a7ea7f

---

## Starting a new session

Paste this. It is written to stand on its own — a fresh agent needs no other
context.

```
Read CLAUDE.md and docs/superpowers/HANDOFF.md in this repo, in that order, then
continue the FibX app widget work from where it stands.

The branch is worktree-mcp-apps-panel. Three plans have run on it, back to
back; the first two are complete and superseded respectively (see "Read this
first"). The third — docs/superpowers/plans/2026-09-05-fibx-app-widget.md,
spec docs/superpowers/specs/2026-09-05-fibx-app-widget-design.md — has Tasks
1-9 complete and reviewed. Task 10, manual verification against a real wallet
in Claude Desktop, is a human's and is outstanding. `git log --oneline
main..HEAD` tells you what is done.

Do not attempt the things HANDOFF.md lists under "Waiting on you" — they are
mine. Tell me when you need one and I will run it.

Read the Landmines section before touching any test.
```

If the worktree directory is gone, run this first — the branch survives even
when the worktree does not:

```bash
git worktree add .claude/worktrees/mcp-apps-panel worktree-mcp-apps-panel
```

```bash
pnpm install && pnpm build
```

---

## Where the work lives

| What                 | Where                                                                     |
| -------------------- | ------------------------------------------------------------------------- |
| Branch               | `worktree-mcp-apps-panel`                                                 |
| Worktree             | `.claude/worktrees/mcp-apps-panel`                                        |
| Branched from        | `main` at `ca361c8`                                                       |
| Spec (plan 1)        | `docs/superpowers/specs/2026-08-30-mcp-apps-wallet-panel-design.md`       |
| Plan 1               | `docs/superpowers/plans/2026-08-30-mcp-apps-wallet-panel.md`              |
| Spec (plan 2)        | `docs/superpowers/specs/2026-09-02-panel-buttons-and-swap-card-design.md` |
| Plan 2               | `docs/superpowers/plans/2026-09-02-panel-buttons-and-swap-card.md`        |
| Spec (plan 3)        | `docs/superpowers/specs/2026-09-05-fibx-app-widget-design.md`             |
| Plan 3               | `docs/superpowers/plans/2026-09-05-fibx-app-widget.md`                    |
| Ledgers (gitignored) | `.superpowers/sdd/<plan-name>/progress.md`                                |

If the worktree is gone, the branch is not — `git worktree add
.claude/worktrees/mcp-apps-panel worktree-mcp-apps-panel` brings it back, then
`pnpm install`. The ledgers will not come back; this file is the replacement.

---

## What is being built

The FibX app widget: one interactive surface that renders inside MCP hosts
(MCP Apps, the `ui://` resource extension), covering pairing a wallet, seeing
what is signing, reading and editing the signing policy, picking a token pair,
and swapping — pairing, policy and swap together in the one document a chat
turn opens.

The finding that shapes the whole design: **MCP Apps does not require a hosted
server.** A local stdio server can serve a `ui://` resource. That is what lets
the wallet, the session and the policy file all stay on the user's machine.
A hosted MCP server was the alternative and was rejected — it would have moved
the WalletConnect session, and with it the signing policy, onto our
infrastructure, which is the one property this product is built to avoid.

### One tool, one document

**`open_fibx` is the only tool bound to a `ui://` resource.** It composes the
handlers `get_auth_status`, `get_balance`, `get_policy` and, when the caller
gave a pair and an amount, `get_quote` already expose headlessly — so one turn
produces one widget instance, seeded consistently, rather than several tools
each drawing their own fragment of it. Every other tool — `get_quote`,
`get_auth_status`, `get_balance`, `get_policy`, `swap_tokens` — stays headless,
exactly as the CLI and `fibx-telegram-bot` already call them. One new headless
tool, `list_tokens`, feeds the picker. `ui/src/machine.ts` (see Landmines) is
the only place the swap flow's transitions live; `ui/src/app.tsx` is the shell
that lays out pairing, policy and the swap form as one surface.

Why one document rather than a second `ui://` resource: `vite-plugin-
singlefile` inlines everything a document imports — including the `ext-apps`
SDK's `App` schema layer, ~330 KB by itself — into one self-contained HTML
file that esbuild then inlines as text into the server bundle every `fibx`
invocation loads. A second Vite entry pays for that layer a second time from
scratch — measured, on this same repo, at 340 KB for a stub that did nothing
but import `App`. Paying for that layer once is the only reason to keep
everything behind one document, whatever sits on top of it.

_History: plan 2 served this one document under **two** `ui://` URIs with
different `_meta`, because the panel declared `clipboardWrite` and the swap
card declared no permissions — one iframe must not carry a capability the
other had no business holding. Plan 3 collapsed the panel and the card into
one application, so there is now exactly one tool and one URI; the two-URI
split has no reason left to exist._

### The dev host

`pnpm dev:ui` opens a local host against fixtures — every widget state
(connected, a quote, a simulate that needs an approval, a confirmed and a
reverted broadcast, an insufficient-funds error) is one click away, and its
_grant clipboardWrite_ and _accept wc:_ checkboxes reproduce Claude Desktop's
own refusals instead of guessing at them. `pnpm dev:ui:bridge` swaps the
fixtures for a real `fibx mcp-start` process over stdio — **a Swap there is a
real swap**, not a fixture; do not press it in bridge mode outside Task 10.

Because that bridge holds a client to the real server, three things bound what
can reach it while it runs. It listens on `127.0.0.1` only, so nothing on the
LAN can reach it. It answers one exact origin — the Vite dev server's,
`http://localhost:5173` or `http://127.0.0.1:5173` — and refuses every other
with `403` and no CORS headers, so no other page the developer has open can
preflight its way in. And it relays only the twelve tools `ui/src` itself
calls, refusing anything else with `403`; `send_tokens` and `aave_action` are
deliberately not among them.

See "Read this first" above for the DOM test environment and the byte guard.

---

## Done

**Shipped to `main` and pushed, but not published to npm — version 0.10.0:**

- WalletConnect as a first-class signing path (QR pairing, own wallet).
- A local signing policy — per-chain native cap, allowed chains, allowed
  destinations, expiry — enforced in front of all three signing paths, plus
  `fibx auth setup` to choose between them.
- Verified by hand on a real wallet: the same transfer refused under a low cap
  and confirmed with a hash once the cap was raised.

### Plan 1 — the wallet panel (complete)

| Task                                                    | State                                                                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — build pipeline, panel renders as a `ui://` resource | complete (`bedbe04`), reviewed clean; **gate PASSED 2026-09-01** — panel rendered in Claude Desktop                                                                       |
| 2 — `get_policy` tool                                   | complete (`ceca59f`), reviewed clean                                                                                                                                      |
| 3 — `set_policy_rule`, `clear_policy_rule`              | complete (`52d3fd4`..`081e7e7`), reviewed clean after one fix round                                                                                                       |
| 4 — `logout` tool                                       | complete (`04f36f5`), reviewed clean                                                                                                                                      |
| 5-8 — the panel's real UI                               | all complete: 5 (`aa7fafb`), 6 (`182781c`), 7 (`ec0156c`), 8 (`1802499`); second whole-branch review passed after one fix round (`e42b460`, `930d6fc`)                    |
| 9 — manual verification                                 | **done 2026-09-02** — disconnected/QR/shortcuts, re-pair, connected view, policy round trip all verified on a real wallet; the unreadable-file step was left to its tests |

### Plan 2 — panel buttons and the swap card (superseded before Task 8 ran)

| Task                                                 | State                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1 — the clipboard permission and the `wc:` URI       | complete (`56ddb2e`)                                                                                            |
| 2 — Fibrous palette and rhythm                       | complete (`5c89121`)                                                                                            |
| 3 — protocol ids resolved to names                   | complete (`3ad7690`)                                                                                            |
| 4 — `get_quote` returns the route it already fetched | complete (`85135b8`, with `d02012b` isolating `quote.test.ts` from the real config directory)                   |
| 5 — a second `ui://` entry                           | built (`6eb87f0`), **measured and reverted** to one document behind two URIs (`c567304`) — see above            |
| 6-7 — the swap card                                  | complete (`ca8f57c`), then one review fix round (`99292a0`) and `updateModelContext` on the panel (`790a4d4`)   |
| whole-branch review fixes                            | complete (`2e04332`, `f1727d2`, and this commit) — the card's honesty, the slippage bound, housekeeping         |
| 8 — manual verification                              | **superseded — never run.** No swap card is left to verify; see plan 3's Task 10 under "Waiting on you" instead |

Test count moved 229 → 255 across plan 1, and 255 → 341 across plan 2.

### Tool contract changes a consumer should know about

Both surface through MCP and the CLI, so `fibx-server`, `fibx-telegram-bot` and
`fibx-skills` may care:

- **`slippage` is bounded.** `get_quote` and `swap_tokens` take 0.01-50, and so
  do `fibx quote --slippage` and `fibx trade --slippage`. The bound has one
  definition, `slippageSchema` / `validateSlippage` in `src/lib/validation.ts`;
  the tool schemas and both CLI commands call it. The app's swap form
  (`ui/src/quote.ts`'s `checkSlippage`) refuses above a tighter 5% of its own,
  because a human typing into a box is a different risk from a caller asking
  for a wide slippage on an illiquid pair.
- **`usdIn`, `usdOut` and `priceImpact` are nullable.** A missing token price
  used to arrive as `0`, which rendered as "$0.00" beneath a real amount and, via
  price impact's zero branch, as a green "0.00%" — a fabricated safety signal on
  the one number that exists to make a user stop. Absent is now `null` all the
  way to the surface, and a consumer must render it as an explicit unknown
  rather than as a zero.
- **`get_quote` returns a `quote` object** carrying the route's hops (with
  protocol display names where the Fibrous graph API resolves them), the exact
  output, the slippage floor and the derived price impact. Wrap/unwrap results
  still have no `quote` — a 1:1 conversion has no route to describe.
- **`open_fibx` is new, and it is the only tool bound to a `ui://` resource.**
  It takes `chain` plus an optional `from`/`to`/`amount`/`slippage` and answers
  with the whole snapshot the app opens on — auth, balances, policy, and a
  quote where one was asked for. Its description now says which host it is
  for: it opens with `In a host that renders UI, ` and closes by naming
  `get_auth_status`, `get_balance` and `get_quote` as what to reach for
  instead in a text-only host. `fibx-telegram-bot` and CLI agents see this
  tool and cannot render it, so that last sentence is the contract for them.
- **`list_tokens` is new and headless.** It takes a `chain` and returns the
  tokens Fibrous supports on it — symbol, name, address, decimals, and a USD
  price where one is known. It exists for the app's token picker; nothing
  stops another consumer using it.

---

## Waiting on you

### 1. Task 10 — manual verification, on a real wallet in Claude Desktop

**Nobody has done this.** It is the gate on `npm publish`. Full steps are in
`docs/superpowers/plans/2026-09-05-fibx-app-widget.md`'s Task 10; the six
gates, one line each (the sixth was added by the branch review — it is the
only one that needs no wallet):

1. **The model reaches for `open_fibx`** for a wallet-status question, a
   what-would-I-get question and a swap request alike — all three should open
   the same whole app, not prose from a headless tool.
2. **The pairing buttons explain themselves or work** — Copy link either
   copies a `wc:` URI or turns into the clipboard-refused sentence, Open in
   your wallet either opens a wallet or turns into the wallet-links sentence;
   a button that stays and does nothing is a fail.
3. **Connect, and the model agrees** — after scanning the QR, the header shows
   the address and the model's next sentence says the wallet is connected.
4. **The form refuses a shortfall before any call, and unlocks Swap only
   after Simulate** — an amount above balance shows "Insufficient balance"
   with Simulate disabled; a valid amount quotes, simulates, then unlocks Swap.
5. **A small real swap settles, and the model says so honestly** — the widget
   follows the hash to settled and the model's next turn says the swap
   _settled_, never "swapped X for Y" as fact before the receipt arrives; then
   a tightened `base.maxValue` still refuses a swap and names the rule.
6. **Both refusals, seen once** — in the dev host (`pnpm dev:ui`, no bridge
   needed), open the pairing view with _grant clipboardWrite_ and _accept
   wc:_ **both unchecked**. Copy link must become the clipboard-refused
   sentence and Open in your wallet the wallet-links sentence. This is the
   state that motivated the spec, and nobody has yet watched either control
   actually be refused — gate 2 above sees them granted.

```bash
git commit --allow-empty -m "chore: verify the app by hand on a real wallet"
```

### 2. Merge

`git checkout main && git merge --no-ff worktree-mcp-apps-panel` from the main
checkout. Deliberately not done by an agent: a shared-branch side effect. After
merging, the SDD workspaces under `.superpowers/` and the worktree can go.

### 3. Repoint the Claude Desktop config

`claude_desktop_config.json`'s `mcpServers.fibx-dev` entry currently points at
**this worktree's** `dist/index.js` (a `.bak` of the pre-edit file sits beside
it). **It breaks the moment this worktree is removed.** Before that happens,
point it at the main checkout instead and build there:

```json
"mcpServers": { "fibx-dev": { "command": "node", "args": ["/Users/ahmetenesdur/workspace/fibx/dist/index.js", "mcp-start"] } }
```

```bash
pnpm build
```

(run from the main checkout, not this worktree)

### 4. npm publish of 0.10.0 — gated on Task 10

`main` is pushed and `origin/main` is current. npm is **not** logged in on this
machine, so the release has to come from you, and only once Task 10 above has
passed:

```bash
npm login
```

```bash
npm publish
```

Then the MCP registry, which needs `fibrous-mcp-key.pem` (gitignored, local to
your machine):

```bash
./mcp-publisher publish
```

`package.json` and `server.json` are already both at 0.10.0 — the registry
rejects a publish whose manifest version does not match the npm package, so
keep them in step on every future release.

_History: the gate that proved the underlying pipeline — a local stdio server
serving a `ui://` resource at all — passed on 2026-09-01, before either the
swap card or the app existed: "Widget from fibx-dev get_auth_status" appeared
inline with the real JSON. That question is answered; Task 10 above is the
current one._

---

## How to resume

1. Read the plans and specs named above.
2. Read the ledger for the plan you are resuming if the worktree still exists;
   it carries per-task rulings and deferred minor findings. If it is gone, this
   file plus `git log` is enough.
3. Use the `superpowers:subagent-driven-development` skill. Tasks with a
   `Task N: complete` line in the ledger are done; resume at the first without
   one. If the ledger is gone, `git log --oneline main..HEAD` tells you the same
   thing from the commit messages.
4. One implementer subagent per task, then a task review, then the next.

---

## Landmines

Things that have already gone wrong once, or nearly did.

**Never let a test touch the real config directory.** `policyPath()` and
`sessionPath()` resolve to the actual `~/Library/Preferences/fibx-nodejs`, which
holds the live session, the encrypted key and the WalletConnect pairing.
`env-paths` ignores `XDG_CONFIG_HOME` on macOS, so environment variables isolate
nothing — mock `../../lib/config.js`, the way `src/services/policy/store.test.ts`
does. A test that called `clearSession()` in a `beforeEach` was caught before
dispatch; a shipped integration test was found reading the developer's real
`policy.json` during plan 1's final review; and `src/mcp/handlers/quote.test.ts`
was found reading the real `config.json` during plan 2 (`d02012b`).

**The order of the branches in `src/mcp/handlers/policy.ts` is load-bearing.**
`isEmptyPolicy("unreadable")` evaluates to `true`, because every field read on a
string primitive returns `undefined`. What keeps an unreadable policy from being
reported as "no policy" is that the string is checked _first_ — not that it is
checked at all. Reordering those branches reintroduces a fail-open that a
previous phase spent a fix round removing.

**Do not bump `@modelcontextprotocol/sdk` to satisfy the `ext-apps` peer
range.** `ext-apps@1.7.5` asks for `^1.29.0` and the repo pins `^1.27.1`. This
was investigated at source level: `registerAppTool` and `registerAppResource`
are passthroughs to `registerTool`/`registerResource`, `getUiCapability` is
never called by this code, and the `ui/initialize` handshake is `ext-apps`' own
postMessage sub-protocol, independent of the stdio connection's SDK version.
Every SDK export in use exists at 1.27.1. Bumping would inject an untested
migration across the auth, wallet, trade and DeFi tools for no evidenced gain.

**`maxValue` does not bound token amounts.** An ERC-20 transfer reaches the
policy as `{ to: <the token contract>, value: 0n }`, so the cap never sees the
amount. `allowedDestinations` is what bounds where tokens may go. The README
claimed otherwise once; do not let a UI reintroduce the claim. This is also why
slippage has to be bounded in the code — nothing downstream can catch a bad one.

**`fibx send` simulates before it signs.** On an address with no gas money the
simulation fails at `eth_estimateGas` before the policy is consulted, so an
empty throwaway wallet cannot demonstrate a policy refusal through the CLI.
Drive the gate directly instead — plan 1's Task 8 has the code.

**A swap that throws may still have broadcast an approval.**
`handleSwapTokens` (`src/mcp/handlers/trade.ts`) broadcasts an ERC-20 `approve`,
waits for its receipt, waits for the allowance, and only then sends the swap. Any
throw after that first `sendTransaction` — a policy refusal on the swap leg, a
wallet rejection, a relay timeout — reaches the caller with no hash, while an
approval is already on chain, has cost gas and has left a standing allowance to
the router. The swap form's `failed` phase (`ui/src/swap-form.tsx`) says so to
the user; a comment there once claimed the opposite ("nothing left this
machine") and that false invariant was the dangerous part. Nothing structural
has changed in the handler.

**Open follow-up: promote `applyRule` / `removeRule` to `FibxError`.**
They throw plain `Error`, so a bad rule name or chain reaches MCP callers with
the right message but an uninformative `UNKNOWN_ERROR` code — not a break, since
the message is what a caller reads, but a UI must not branch on the code for
these paths. `ErrorCode.VALIDATION_ERROR` exists in `src/lib/errors.ts` and is
now used by `validateSlippage`, so the precedent is set. The fix belongs at the
one source of truth in `src/commands/policy/index.ts` and would improve the CLI
and MCP together — but it changes the CLI's visible output across about six
throw sites (`✖ [VALIDATION_ERROR] …` instead of `✖ …`), so it is its own task,
deliberately deferred rather than an oversight. Until then, a UI must render the
message rather than branching on the code. The one exception is the
unreadable-policy refusal, which reliably carries `POLICY_BLOCKED`.

**`parseEvmError` can rewrite a validation error into a retry-suggesting
network error.** `withErrorHandling` routes any non-`FibxError` through it —
which is exactly what `applyRule` / `removeRule` throw, per the follow-up
above — and it was proved that `Unknown chain: 429` becomes "RPC rate limited
— please retry", so a model given a permanently invalid rule name is told to
loop instead of correcting it. The trigger is contrived (a rule name that
happens to look like an HTTP status) and the realistic cases pass through
verbatim, but it is evidence against this follow-up's premise that validation
failures already reach callers with the right message — sometimes they do not.
Found during the final-review round on the MCP Apps wallet panel branch
(2026-09-01); not fixed, since the fix is the same deferred `FibxError`
promotion above.

**A failed tool result is not an `isError` result.** `withErrorHandling` catches
everything and returns a _normal_ tool result whose body is `{ success: false,
error, code, rawMessage }`; the SDK sets `isError: true` only when a handler
throws past its own catch, in practice zod input validation. Two consequences,
both already paid for once: `ui/src/rpc.ts` must throw on either shape (a client
checking only `isError` decodes a failed `connect_wallet` as a pairing with
undefined fields — `ui/src/rpc.test.ts` pins both), and the **host still renders
the `ui://` resource bound to the tool**, so `ui/src/main.tsx` checks
`success === false` before rendering anything from the payload. Without that
check, a `get_quote` that could not resolve a token once drew the old swap
card with blank amounts over a live Simulate button; the current single-app
document is the same class of surface and needs the same guard.

**CLI-flavoured error text reaches MCP callers.** `set_policy_rule("allowedChains",
"")` returns "Remove the rule with `fibx policy clear allowedChains` instead" —
a shell command, to a caller that now has `clear_policy_rule`. Same family:
policy refusals name `fibx policy show` and `fibx policy set expiry`. Harmless
today (the message is still readable), but worth cleaning up whenever the
`FibxError` promotion above happens, since both touch the same throw sites.

**The app resource's metadata is thin.** `src/mcp/ui.ts`'s `registerApp` passes
`APP_URI` itself as the human-readable `name` argument to `registerAppResource`,
so `resources/list` returns the URI string as the name, and there is no
`description`. The explicit `{ mimeType: RESOURCE_MIME_TYPE }` passed alongside
it is also redundant — `registerAppResource` already defaults `mimeType` to
that same constant.

**The five-line logout comment is duplicated verbatim** between
`src/commands/auth/logout.ts` and `src/mcp/handlers/auth.ts` ("The user asked
to leave. Whatever became of the wallet's side, the local session goes...").
Worth factoring out if either surface's logout behavior changes.

**`prepublishOnly` shells out to `npm run build`** in `package.json`, while the
rest of the repo and its release recipe use pnpm. Works today because `npm run
build` still resolves the same script, but it is the odd one out.

**The Claude Desktop config points at this worktree, not `main`.**
`claude_desktop_config.json`'s `mcpServers.fibx-dev` entry runs `node
<this worktree>/dist/index.js mcp-start`. It breaks the moment this worktree is
removed — repoint it at the main checkout's `dist/index.js` and `pnpm build`
there before that happens. See "Waiting on you" above.

**The app costs ~370 KB in the published bundle.** `dist/index.js` is
2,817,672 bytes as of this commit, and the one built document inlined into it
(`ui/dist/index.html`) is **369,812 bytes** — roughly 90% zod and the MCP SDK's
schema layer, pulled in transitively by `App` from
`@modelcontextprotocol/ext-apps`, not by Preact, which accounts for only ~4 KB.
With `splitting: false` this sits in the single bundle every `fibx` invocation
loads and `npx fibx` downloads — the startup-path cost commit `b7ee51d` was
written to protect. The guard is `src/mcp/ui.test.ts`'s 400,000-byte ceiling,
measured in **bytes** (`Buffer.byteLength`) — an earlier version of this same
guard measured `String.length`'s UTF-16 code units instead and quietly
reported headroom that did not exist, because chars and bytes diverge once the
document holds any multi-byte content. Roughly 30,200 bytes of real headroom
remains. Whether the lighter `@modelcontextprotocol/ext-apps/app-bridge` entry
point (43 KB) would suffice is still unanswered, and is the one lever that
would move this number.

**The app treats a failed handshake as fatal for the session.** `Root` in
`ui/src/main.tsx` shows `connect failed: …` and never retries; there is no
reconnect flow. Deliberate for now — the message is what made the original
gate diagnosable — but a "try again" that re-runs `app.connect()` is a small,
worthwhile follow-up.

**MCP Apps do not push UI state to the model — every surface must push it
itself.** After a user acted inside the panel, the model's next turn still
believed the last tool result it saw, so its prose said "not connected" under a
panel showing connected. Seen during plan 1's Task 9, fixed in `790a4d4` for the
panel and, harder, for the swap card: the card's broadcast update once said
"Swapped X for Y" the moment `sendTransaction` returned a hash, and nothing
retracted it when the transaction reverted. **Every terminal state now sends its
own `updateModelContext`** — broadcast (a hash and nothing more), confirmed,
reverted, and the polling window running out. All fire-and-forget with a
`.catch`, setting no state: telling the model is not part of the swap and must
never break the card. If you add a terminal state, it needs one too.

**Do not disturb the machine's `unknown` phase.** A poll that runs out of
attempts is terminal (`ui/src/machine.ts`) and disables Swap, Simulate, Refresh
**and** the slippage input in `ui/src/swap-form.tsx`. Locking all four is what
closes the duplicate-swap hole — either of the other controls would otherwise
re-arm Swap on a transaction that may still be in flight — and it is
deliberately not `failed`, which is the pre-broadcast case where retrying is
safe.

**`ui/` now has component tests; an earlier round almost shipped without
them.** The pure helpers (`status.ts`, `rpc.ts`, `quote.ts`, `tokens.ts`) were
tested from the start; the interactive pieces were not, because vitest ran
with `environment: "node"`. An implementer once claimed CLAUDE.md's
zero-dependency rule forbids a DOM testing library. **That is a
misreading — the rule is that `dependencies` stays empty; new packages go in
`devDependencies`, which is where vitest itself lives.** The recipe that
followed: `happy-dom` as a devDependency, `// @vitest-environment happy-dom`
per file, and `mount()`/`fakeApp()` in `ui/src/test-utils.ts` as the load-
bearing helpers — no `@testing-library` package was needed. `app.tsx`,
`pairing.tsx`, `picker.tsx`, `policy.tsx`, `swap-form.tsx` and `machine.ts`
each have a test file beside them now, covering the write gating, the
two-step policy wipe, the simulate gate and the `unknown` lock.
`updateModelContext` itself is fire-and-forget by design and is not asserted
against in any of them — reading the code is still how its terminal-state
coverage gets checked.

**Plan 1's Task 9 step 6 corrupts the real policy file on purpose — clean it
up.** `echo '{ not json' > …/policy.json` is the right way to see the unreadable
state, and an unreadable policy refuses every signature. Run
`fibx policy clear --yes` afterwards or nothing signs until you do.

**The annotation test reads a private SDK field.** `src/mcp/tools/annotations.test.ts`
asserts against `McpServer._registeredTools`, which SDK 1.27.1 declares `private`
and exposes no public lookup for. It is the only test that pins `readOnlyHint` /
`destructiveHint`, and it will break loudly on an SDK bump that renames the field —
which is the failure mode we want. Replace it then with a `tools/list` round-trip
over an in-memory transport, not before.

**`config_action` still accepts a withdrawn chain.** `src/mcp/handlers/auth.ts`
and `src/commands/config/index.ts` check `SUPPORTED_CHAINS[chain]` for
existence, so `set-rpc citrea …` is accepted and the "Supported:" text lists
Citrea. Same class as the portfolio crash — a consumer reading the structural
table as the offered list — but harmless (it stores an RPC URL nobody will
use) and not fixed here. Switch those checks to `isOffered()` when next in
those files.

**`ui/src/machine.ts` is the only place the swap flow's transitions live.**
Every control's `disabled` expression must derive from `isLocked`/`canSwap`,
never from ad-hoc state — the panel and the swap card each grew their own
gating logic once, and reconciling the two was most of a review round on the
previous plan. One machine, one source of truth for what a click is allowed
to do.

**A brief's sample code can contradict the plan's Global Constraints — the
constraint wins.** This happened three times while this plan was implemented:
a brief's Vite config block, a brief's raw `e.message`, and a brief's
unguarded `JSON.parse` each conflicted with a constraint (no raw error text
to the user, no unhandled parse). The plan document is the higher authority
than any one task's sample code; when they disagree, follow the plan.

**Deferred, deliberately, with reasons in the ledgers:** the cap message omits
the native symbol; `BigInt(tx.value)` throws a raw `SyntaxError` on malformed
hex; `withPolicy` has no Privy-specific test; `chain.name` is used where
`transaction.chainId` would be structurally safer; `tsup.config.ts` and
`vitest.config.ts` each carry their own `.html`-as-text loader and only one is
tested; `ext-apps` declares `engines.node >=20` while fibx declares `>=18`.
None is a break. All fail in the safe direction.
