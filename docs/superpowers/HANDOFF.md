# Handoff — where the work stands

**Last updated:** 2026-08-30

This file exists so a new session can pick the work up without the previous
conversation. It is committed on purpose: the SDD ledger under `.superpowers/`
is gitignored scratch and dies with the worktree, so anything that must survive
lives here.

---

## Read this first

Two things are **blocked on a human** and nothing downstream can move without
them. Both are described in full under "Waiting on you" below.

1. A manual gate in Claude Desktop that decides whether four planned tasks
   happen at all.
2. `npm publish` of 0.10.0, which is built, tested, tagged in git and pushed —
   but not released.

A status page covering the same ground, in a form that is easier to hand to
someone else: https://claude.ai/code/artifact/3f864c62-98bf-4579-b7d9-f4ba65a7ea7f

---

## Starting a new session

Paste this. It is written to stand on its own — a fresh agent needs no other
context.

```
Read CLAUDE.md and docs/superpowers/HANDOFF.md in this repo, in that order, then
continue the MCP Apps wallet panel work from where it stands.

The branch is worktree-mcp-apps-panel. Execute the remaining tasks in
docs/superpowers/plans/2026-08-30-mcp-apps-wallet-panel.md using the
superpowers:subagent-driven-development skill — one implementer subagent per
task, a review after each. `git log --oneline main..HEAD` tells you which tasks
are already done, and the ledger at
.superpowers/sdd/2026-08-30-mcp-apps-wallet-panel/progress.md carries the
per-task rulings if that directory still exists.

Two things are blocked on me rather than on you, and HANDOFF.md describes both.
Do not attempt either — tell me when you need one and I will run it.

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

| What                | Where                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Branch              | `worktree-mcp-apps-panel`                                           |
| Worktree            | `.claude/worktrees/mcp-apps-panel`                                  |
| Branched from       | `main` at `ca361c8`                                                 |
| Spec                | `docs/superpowers/specs/2026-08-30-mcp-apps-wallet-panel-design.md` |
| Plan                | `docs/superpowers/plans/2026-08-30-mcp-apps-wallet-panel.md`        |
| Ledger (gitignored) | `.superpowers/sdd/2026-08-30-mcp-apps-wallet-panel/progress.md`     |

If the worktree is gone, the branch is not — `git worktree add
.claude/worktrees/mcp-apps-panel worktree-mcp-apps-panel` brings it back, then
`pnpm install`. The ledger will not come back; this file is the replacement.

---

## What is being built

An interactive wallet panel that renders inside MCP hosts (MCP Apps, the
`ui://` resource extension), covering pairing a wallet, seeing what is signing,
and reading and editing the signing policy that bounds it.

The finding that shapes the whole design: **MCP Apps does not require a hosted
server.** A local stdio server can serve a `ui://` resource. That is what lets
the wallet, the session and the policy file all stay on the user's machine.
A hosted MCP server was the alternative and was rejected — it would have moved
the WalletConnect session, and with it the signing policy, onto our
infrastructure, which is the one property this product is built to avoid.

---

## Done

**Shipped to `main` and pushed, but not published to npm — version 0.10.0:**

- WalletConnect as a first-class signing path (QR pairing, own wallet).
- A local signing policy — per-chain native cap, allowed chains, allowed
  destinations, expiry — enforced in front of all three signing paths, plus
  `fibx auth setup` to choose between them.
- Verified by hand on a real wallet: the same transfer refused under a low cap
  and confirmed with a hash once the cap was raised.

**On the branch (`worktree-mcp-apps-panel`):**

| Task                                                    | State                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1 — build pipeline, panel renders as a `ui://` resource | code complete (`bedbe04`), reviewed clean; **its manual gate is unanswered**                                            |
| 2 — `get_policy` tool                                   | complete (`ceca59f`), reviewed clean                                                                                    |
| 3 — `set_policy_rule`, `clear_policy_rule`              | code at `52d3fd4`; **in fix round 1** — review found `clear_policy_rule` skipping validation when no policy file exists |
| 4 — `logout` tool                                       | not started                                                                                                             |
| 5-8 — the panel's real UI                               | not started, contingent on the gate                                                                                     |
| 9 — manual verification                                 | not started                                                                                                             |

Test count moved 229 → 231 (Task 1) → 235 (Task 2) → 242 (Task 3).

---

## Waiting on you

### 1. The gate — does the panel actually render?

`ext-apps` issue #671 reports MCP Apps UI never appearing in Claude Desktop.
It is one reporter on an older protocol revision through a proxy, and
Anthropic's own docs show it working, so it is unverified rather than known
broken. Task 1 was built specifically to answer this cheaply before the
expensive UI work.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`, inside
the outermost braces (the file currently has no `mcpServers` key):

```json
"mcpServers": { "fibx-dev": { "command": "node", "args": ["/Users/ahmetenesdur/workspace/fibx/.claude/worktrees/mcp-apps-panel/dist/index.js", "mcp-start"] } }
```

Quit Claude Desktop fully — not just the window — reopen it, and in a new chat
ask it to check your wallet status with fibx.

- **A panel appears** with the heading "FibX Wallet" and the JSON
  `get_auth_status` returned → the gate passed. Tasks 5 to 8 go ahead, and
  **they must be re-specified at full resolution first** — the plan says so
  itself, because their markup was deliberately left unwritten while rendering
  was unproven.
- **Only plain text appears** → issue #671 applies here too. Cancel Tasks 5 to
  8, finish Tasks 3 and 4 anyway, and merge. Those tools close a real gap
  regardless of any UI.

The panel will look crude either way. Task 1's only job was to prove the
pipeline.

### 2. npm publish of 0.10.0

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

1. Read the plan and the spec named above.
2. Read the ledger if the worktree still exists; it carries per-task rulings and
   deferred minor findings. If it is gone, this file plus `git log` is enough.
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
`policy.json` during the previous phase's final review.

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
claimed otherwise once; do not let a UI reintroduce the claim.

**`fibx send` simulates before it signs.** On an address with no gas money the
simulation fails at `eth_estimateGas` before the policy is consulted, so an
empty throwaway wallet cannot demonstrate a policy refusal through the CLI.
Drive the gate directly instead — the plan's Task 8 has the code.

**Open follow-up: promote `applyRule` / `removeRule` to `FibxError`.**
They throw plain `Error`, so a bad rule name reaches MCP callers with the right
message and an uninformative `UNKNOWN_ERROR` code. `ErrorCode.VALIDATION_ERROR`
already exists, unused, in `src/lib/errors.ts`. The fix belongs at the one
source of truth in `src/commands/policy/index.ts` and would improve the CLI and
MCP together — but it changes the CLI's visible output across about six throw
sites (`✖ [VALIDATION_ERROR] …` instead of `✖ …`), so it is its own task. Until
then, a UI must render the message rather than branching on the code. The one
exception is the unreadable-policy refusal, which reliably carries
`POLICY_BLOCKED`.

**Validation errors from the policy tools carry `UNKNOWN_ERROR`.**
`applyRule` and `removeRule` throw plain `Error`, not `FibxError`, so a bad rule
name or chain surfaces over MCP with the right message but an uninformative
code. Not a break — the message is what a caller reads — but a panel must not
branch on the code for these paths. Changing `applyRule` to throw `FibxError`
would also change the CLI's output (`✖ [VALIDATION_ERROR] …` instead of `✖ …`),
so it is a deliberate open question rather than an oversight.

**Deferred, deliberately, with reasons in the ledger:** the cap message omits
the native symbol; `BigInt(tx.value)` throws a raw `SyntaxError` on malformed
hex; `withPolicy` has no Privy-specific test; `chain.name` is used where
`transaction.chainId` would be structurally safer; `tsup.config.ts` and
`vitest.config.ts` each carry their own `.html`-as-text loader and only one is
tested; `ext-apps` declares `engines.node >=20` while fibx declares `>=18`.
None is a break. All fail in the safe direction.
