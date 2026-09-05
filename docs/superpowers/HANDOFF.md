# Handoff — where the work stands

**Last updated:** 2026-09-04

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
never raised. The document is at **369,082 bytes** as of this commit.

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
continue the MCP Apps panel work from where it stands.

The branch is worktree-mcp-apps-panel. Both of its plans live in
docs/superpowers/plans/ — 2026-08-30-mcp-apps-wallet-panel.md is complete, and
2026-09-02-panel-buttons-and-swap-card.md is complete except for its Task 8,
which is a human's. `git log --oneline main..HEAD` tells you what is done.

Do not attempt the three things HANDOFF.md lists under "Waiting on you" — they
are mine. Tell me when you need one and I will run it.

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
| Ledgers (gitignored) | `.superpowers/sdd/<plan-name>/progress.md`                                |

If the worktree is gone, the branch is not — `git worktree add
.claude/worktrees/mcp-apps-panel worktree-mcp-apps-panel` brings it back, then
`pnpm install`. The ledgers will not come back; this file is the replacement.

---

## What is being built

An interactive wallet panel that renders inside MCP hosts (MCP Apps, the
`ui://` resource extension), covering pairing a wallet, seeing what is signing,
and reading and editing the signing policy that bounds it — plus a swap card
that renders in chat from a `get_quote`, showing the route Fibrous chose and
offering Simulate and Swap.

The finding that shapes the whole design: **MCP Apps does not require a hosted
server.** A local stdio server can serve a `ui://` resource. That is what lets
the wallet, the session and the policy file all stay on the user's machine.
A hosted MCP server was the alternative and was rejected — it would have moved
the WalletConnect session, and with it the signing policy, onto our
infrastructure, which is the one property this product is built to avoid.

### One document, two `ui://` URIs

The most load-bearing structural decision on this branch, and the one most
likely to be undone by someone who does not know why it is there.

`vite-plugin-singlefile` inlines everything a document imports — including the
SDK's `App` schema layer, ~330 KB by itself — into one self-contained HTML file
that esbuild then inlines as text into the server bundle every `fibx`
invocation loads. It is not built for multiple entry points, and on this repo's
Vite 8 (Rolldown) toolchain a multi-input build with inlining enabled hard-fails
outright.

The two-entry design was therefore built, **measured, and rejected**: two
independent builds cannot share anything by construction, so each carried its
own copy of that schema layer — 351.80 KB for the panel plus 340.00 KB for a
swap-card stub that did nothing but import `App`, 691.80 KB together.

So there is exactly **one built document** (`ui/dist/index.html`), registered
under **two `ui://` URIs** with different `_meta`: the panel declares
`clipboardWrite`, the card declares no permissions at all — which is the whole
reason two URIs still exist for one document, since one iframe must not carry a
capability the other has no business holding. The document decides at runtime
(`ui/src/main.tsx`) which surface to render, from the invoking tool's name or
the payload's shape.

**The comment at the top of `src/mcp/ui.ts` explains this properly. Read it
before touching the build.** `walletPanelHtml` and `swapCardHtml` are two names
for the same string, not two files.

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

### Plan 2 — panel buttons and the swap card (Task 8 outstanding)

| Task                                                 | State                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1 — the clipboard permission and the `wc:` URI       | complete (`56ddb2e`)                                                                                          |
| 2 — Fibrous palette and rhythm                       | complete (`5c89121`)                                                                                          |
| 3 — protocol ids resolved to names                   | complete (`3ad7690`)                                                                                          |
| 4 — `get_quote` returns the route it already fetched | complete (`85135b8`, with `d02012b` isolating `quote.test.ts` from the real config directory)                 |
| 5 — a second `ui://` entry                           | built (`6eb87f0`), **measured and reverted** to one document behind two URIs (`c567304`) — see above          |
| 6-7 — the swap card                                  | complete (`ca8f57c`), then one review fix round (`99292a0`) and `updateModelContext` on the panel (`790a4d4`) |
| whole-branch review fixes                            | complete (`2e04332`, `f1727d2`, and this commit) — the card's honesty, the slippage bound, housekeeping       |
| 8 — manual verification                              | **outstanding — a human's, see below**                                                                        |

Test count moved 229 → 255 across plan 1, and 255 → 341 across plan 2.

### Tool contract changes a consumer should know about

Both surface through MCP and the CLI, so `fibx-server`, `fibx-telegram-bot` and
`fibx-skills` may care:

- **`slippage` is bounded.** `get_quote` and `swap_tokens` take 0.01-50, and so
  do `fibx quote --slippage` and `fibx trade --slippage`. The bound has one
  definition, `slippageSchema` / `validateSlippage` in `src/lib/validation.ts`;
  the tool schemas and both CLI commands call it. The swap card refuses above a
  tighter 5% of its own, because a human typing into a box is a different risk
  from a caller asking for a wide slippage on an illiquid pair.
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

---

## Waiting on you

### 1. Task 8 — verify the swap card by hand

**Nobody has done this.** The card puts a button in front of the same signing
path `fibx trade` uses; no automated test proves a card renders in a real host,
and none of plan 2's central claims — that the clipboard now works, that a `wc:`
link reaches a wallet, that a swap goes through — can be checked without a
person and a funded wallet. The plan has the full steps; in short:

1. `pnpm build`, then quit Claude Desktop **entirely** and reopen it so the
   running `fibx-dev` process picks up the new build.
2. Log out, ask for wallet status, press **Copy link** — the label should become
   **Copied** and the `wc:` URI should paste. A button that is absent means the
   host refused the permission, which is the designed fallback, not a failure.
3. Press **Open in your wallet**. A wallet opens, **or** the button disappears
   because the host refused a `wc:` URI. Either is a pass; a button that stays
   and does nothing is a fail.
4. Ask for a quote. Expect You Pay / You Receive, USD values, the rate, the
   price impact and the route as named hops — compare the hops against the same
   pair on the Fibrous interface.
5. Press **Simulate**. Nothing should be sent, and on a token that needs an
   allowance the card should say the swap takes two transactions.
6. Press **Swap** on an amount you are willing to lose. The host prompts, the
   wallet prompts, the card follows the hash to confirmed, and the explorer link
   opens it. **Then read the model's next turn** — it should say the swap
   confirmed, and it must not say so before the receipt arrives. This is the
   step the last review round was about.
7. `node dist/index.js policy set base.maxValue 0.00001`, swap again, expect a
   refusal naming the cap — the card is a surface over the same signing path,
   not a way around it. Then `node dist/index.js policy clear --yes`.
8. `git commit --allow-empty -m "chore: verify the buttons and the swap card by hand"`

**Already wired on this machine (2026-09-01):** `claude_desktop_config.json`
carries an `mcpServers.fibx-dev` entry pointing at the worktree's
`dist/index.js`, with a `.bak` of the pre-edit file beside it. If the entry is
ever missing, this is what goes inside the outermost braces:

```json
"mcpServers": { "fibx-dev": { "command": "node", "args": ["/Users/ahmetenesdur/workspace/fibx/.claude/worktrees/mcp-apps-panel/dist/index.js", "mcp-start"] } }
```

The gate that proved the pipeline (2026-09-01) is answered — "Widget from
fibx-dev get_auth_status" appeared inline with the real JSON — so a blank
result now is a regression, not the open question it once was. The four
readings that made it diagnosable still apply: a panel with the heading and the
JSON is a pass; a panel saying `connect failed: …` rendered but failed the
`ui/initialize` handshake and the text is diagnosable; a panel stuck on
"waiting for the host…" rendered but the host never answered; only plain text
means the host is not rendering `ui://` resources at all.

### 2. Merge

`git checkout main && git merge --no-ff worktree-mcp-apps-panel` from the main
checkout. Deliberately not done by an agent: a shared-branch side effect. After
merging, the SDD workspaces under `.superpowers/` and the worktree can go.

### 3. npm publish of 0.10.0

`main` is pushed and `origin/main` is current. npm is **not** logged in on this
machine, so the release has to come from you:

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
the router. The swap card's `failed` phase says so to the user; a comment there
once claimed the opposite ("nothing left this machine") and that false invariant
was the dangerous part. Nothing structural has changed in the handler.

**Open follow-up: promote `applyRule` / `removeRule` to `FibxError`.**
They throw plain `Error`, so a bad rule name or chain reaches MCP callers with
the right message but an uninformative `UNKNOWN_ERROR` code — not a break, since
the message is what a caller reads, but a panel must not branch on the code for
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
`success === false` before it picks a surface. Without that check a `get_quote`
that could not resolve a token drew a swap card with blank amounts over a live
Simulate button.

**CLI-flavoured error text reaches MCP callers.** `set_policy_rule("allowedChains",
"")` returns "Remove the rule with `fibx policy clear allowedChains` instead" —
a shell command, to a caller that now has `clear_policy_rule`. Same family:
policy refusals name `fibx policy show` and `fibx policy set expiry`. Harmless
today (the message is still readable), but worth cleaning up whenever the
`FibxError` promotion above happens, since both touch the same throw sites.

**The wallet panel resource's metadata is thin.** `src/mcp/ui.ts` passes the
`ui://` URI itself as the human-readable `name` argument to
`registerAppResource`, so `resources/list` returns the URI string as the name,
and there is no `description`. The explicit `{ mimeType: RESOURCE_MIME_TYPE }`
passed alongside it is also redundant — `registerAppResource` already defaults
`mimeType` to that same constant.

**The five-line logout comment is duplicated verbatim** between
`src/commands/auth/logout.ts` and `src/mcp/handlers/auth.ts` ("The user asked
to leave. Whatever became of the wallet's side, the local session goes...").
Worth factoring out if either surface's logout behavior changes.

**`prepublishOnly` shells out to `npm run build`** in `package.json`, while the
rest of the repo and its release recipe use pnpm. Works today because `npm run
build` still resolves the same script, but it is the odd one out.

**The panel costs ~430 KB in the published bundle.** `dist/index.js` is
2,806,911 bytes as of this branch's head, and the one built document inlined
into it (`ui/dist/index.html`) is **361,521 bytes** — roughly 90% zod and the
MCP SDK's schema layer, pulled in transitively by `App` from
`@modelcontextprotocol/ext-apps`, not by Preact, which accounts for only ~4 KB.
With `splitting: false` this sits in the single bundle every `fibx` invocation
loads and `npx fibx` downloads — the startup-path cost commit `b7ee51d` was
written to protect. The guard is `src/mcp/ui.test.ts`'s 400 KB ceiling, which
measures **bytes** (`Buffer.byteLength`), not `String.length`'s UTF-16 code
units — the document is 343,478 chars against those 361,521 bytes, and the char
count was quietly reporting 18 KB of headroom that does not exist. Roughly
38 KB of real headroom remains. Whether the lighter
`@modelcontextprotocol/ext-apps/app-bridge` entry point (43 KB) would suffice
is still unanswered, and is the one lever that would move this number.

**The panel treats a failed handshake as fatal for the session.** `Root` in
`ui/src/main.tsx` shows `connect failed: …` and never retries; there is no
reconnect flow. Deliberate for now — the message is what made the gate
diagnosable — but a "try again" that re-runs `app.connect()` is a small,
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

**Do not disturb the swap card's `unknown` phase.** A poll that runs out of
attempts is terminal and disables Swap, Simulate, Refresh **and** the slippage
input. Locking all four is what closes the duplicate-swap hole — either of the
other controls would otherwise re-arm Swap on a transaction that may still be in
flight — and it is deliberately not `failed`, which is the pre-broadcast case
where retrying is safe.

**`ui/` has no component tests, and the reason once given was wrong.** The pure
helpers (`status.ts`, `rpc.ts`, `wallets.ts`, `quote.ts`) are tested; the state
machines in `panel.tsx` and `swap-card.tsx` that gate every write are not,
because vitest runs with `environment: "node"`. An implementer claimed CLAUDE.md's
zero-dependency rule forbids a DOM testing library. **That is a
misreading — the rule is that `dependencies` stays empty; new packages go in
`devDependencies`, which is where vitest itself lives.** So the recipe stands:
`happy-dom` and `@testing-library/preact` as devDependencies, a vitest
`environment` override for `ui/**`, and tests for the write gating (no tool call
without a click), the two-step policy wipe, and the swap card's guard wiring —
the simulate gate, the `unknown` lock, and an `updateModelContext` in every
terminal branch. This is the top follow-up on the UI: every Important finding of
every review so far was found by reading, not by a test.

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
