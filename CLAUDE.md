# FibX

A zero-runtime-dependency CLI and stdio MCP server for DeFi on Base, HyperEVM
and Monad — swaps and quotes through Fibrous aggregation, transfers, portfolio,
Aave V3. One published artifact serves both surfaces: `fibx <command>` for
people, `fibx mcp-start` for agents.

## Three signing paths, and why that matters

Every design decision in this repo comes back to this. A user signs through one
of three paths, and they are peers rather than a default plus fallbacks:

| Path                           | Key lives                   | Approval                          | Bounded by                                        |
| ------------------------------ | --------------------------- | --------------------------------- | ------------------------------------------------- |
| WalletConnect (`auth connect`) | the user's own wallet       | every transaction, on their phone | the wallet, plus the local policy                 |
| Privy (`auth login <email>`)   | Privy, server-side          | none — runs unattended            | a server-side Privy policy, plus the local policy |
| Imported key (`auth import`)   | `session.json`, AES-256-GCM | none — runs unattended            | **the local policy alone**                        |

`fibx auth setup` presents the choice. The **local signing policy** — a
user-owned JSON file with a per-chain native cap, an allowed-chain list, an
allowed-destination list and an expiry — is enforced in front of all three, in
two places: a viem `LocalAccount` wrapper (`withPolicy`) for the key and Privy
paths, and the WalletConnect EIP-1193 provider before the request reaches the
relay.

The product argument is that this file is **the user's, on the user's machine**.
Anything that would move it server-side takes the argument with it.

## Hard constraints

- **`dependencies` in `package.json` must stay absent.** Everything ships
  bundled by tsup with `noExternal: [/.*/]`, so `npx fibx` is near-instant. New
  packages go in `devDependencies` only, always.
- **ESM.** Imports carry `.js` extensions even for TypeScript sources. No
  `require()` in source.
- **Style:** tabs for indentation, double quotes, semicolons. Prettier and
  ESLint are the arbiters; run them.
- **Tests are vitest**, colocated as `<name>.test.ts` beside the source.
- **`package.json` and `server.json` versions move together.** The MCP registry
  rejects a publish whose manifest version does not match the npm package.
- **Node floor is the bundle's.** `engines.node` is
  `^20.17.0 || ^22.13.0 || >=23.5.0`: the intersection of the `engines` of
  every package tsup bundles, read from `pnpm-lock.yaml` — inquirer 13 and
  mute-stream set it. Raise it, the tsup `target` and the docs together when a
  bundled dependency raises its own. Developing needs more: Vite 8 and rolldown
  want `^20.19.0 || >=22.12.0`.

## Commands

```bash
pnpm test          # vitest run
pnpm build         # vite (the FibX app widget, ui/) then tsup
pnpm build:ui      # the widget alone — the dev host serves this build
pnpm dev:ui        # the widget in a local host, against fixtures
pnpm dev:ui:bridge # the same host against the REAL server — a Swap there is a real swap
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint src/
pnpm format:check  # prettier --check .
```

Run `tsc --noEmit` before believing a change is done. It has caught phantom
dependencies on this repo that vitest passed straight through — esbuild elides
`import type`, so a package missing from `package.json` only surfaces in the
type check.

CI (`.github/workflows/ci.yml`) runs those checks and the build on Node 22.13.0
and the current LTS, then starts the built bundle with `scripts/smoke.mjs` —
`--version` and an MCP `initialize` + `tools/list` — on the lowest release of
every supported Node line. A bundle that builds can still crash on start.

## Landmines

**Never let a test touch the real config directory.** `policyPath()` and
`sessionPath()` resolve to the actual `~/Library/Preferences/fibx-nodejs`, which
holds the live session, the encrypted private key and the WalletConnect pairing.
**`env-paths` ignores `XDG_CONFIG_HOME` on macOS**, so environment variables
isolate nothing — mock `../../lib/config.js`, the way
`src/services/policy/store.test.ts` does. A test that would have deleted the
developer's session was caught before it ran; a shipped integration test was
later found reading their real `policy.json`.

**Do not run `auth connect`, `auth login` or `auth setup` while testing.** Two
of them open a real WalletConnect pairing or send a real OTP email.

**The policy sees `{ chain, to, value }` and nothing else.** An ERC-20
transfer reaches it as `{ to: <the token contract>, value: 0n }`, so
`maxValue` never sees a token amount, and `allowedDestinations` never sees a
token's recipient: listing a token's contract lets that token go to anyone,
and not listing it blocks the token entirely. Swaps, approvals and Aave calls
go to a router, pool or token contract, which must be listed too. The docs
have claimed twice that one rule or the other bounds tokens; do not
reintroduce either claim.

**`loadPolicy()` returns three states, not two:** `Policy | null | "unreadable"`.
"Absent" permits everything; "unreadable" refuses everything. Collapsing them is
a fail-open, and it has happened twice. In `src/mcp/handlers/policy.ts` the
branch **order** is what protects it: `isEmptyPolicy("unreadable")` evaluates to
`true`, because every field read on a string primitive returns `undefined`, so
the string must be checked first.

**The dev host shows the built widget, not the source.** Its iframe loads
`ui/dist/index.html`, built once when `pnpm dev:ui` starts; Vite's HMR covers
only the host page. After editing anything under `ui/src`, run `pnpm build:ui`
and reload, or the change is invisible. `open_fibx`'s document has a byte
guard in `src/mcp/ui.test.ts` (under 400,000 bytes); keep the widget's
dependencies to what `ui/src` already imports.

**`fibx send` simulates before it signs.** On an address with no gas money the
simulation fails at `eth_estimateGas` before the policy is consulted, so an
empty throwaway wallet cannot demonstrate a policy refusal through the CLI.

**Sibling repos are checked out inside this one** (`fibx-server/`,
`fibx-skills/`, `fibx-telegram-bot/`, all gitignored) and get caught by this
repo's pnpm workspace. They carry their own `.npmrc`; `--ignore-workspace` may
be needed.

**A failed tool call is a normal result, not `isError`.** `withErrorHandling`
(`src/mcp/tools/error-handling.ts`) returns `{ success: false, error, code,
rawMessage }`; the SDK sets `isError` only for what it raises itself, such as
input validation. So `ui/src/rpc.ts` throws on either shape, and because the
host still renders the `ui://` document bound to the tool, `ui/src/main.tsx`
checks `success === false` before drawing anything from the payload.

**Do not bump `@modelcontextprotocol/sdk` to meet `ext-apps`' peer range.**
`ext-apps` asks for a newer SDK than the `^1.27.1` pinned here, but
`registerAppTool`/`registerAppResource` are passthroughs to
`registerTool`/`registerResource`, and the `ui/initialize` handshake is
`ext-apps`' own postMessage protocol, so the stdio SDK version is independent. A
bump is an untested migration of every tool for no evidenced gain.

**The policy commands still throw plain `Error`.** `applyRule`/`removeRule`
(`src/commands/policy/index.ts`) do, so over MCP a bad rule name arrives as
`UNKNOWN_ERROR`, and `parseEvmError` can rewrite its text (`Unknown chain: 429`
reads as "RPC rate limited"). Promoting them to `FibxError(VALIDATION_ERROR)`
fixes both but changes the CLI's output at each throw site, so it is its own
change. The same file's messages tell MCP callers to run `fibx policy clear`.

## How work is done here

Design and planning artifacts live in git and are meant to be read:

- `docs/superpowers/specs/` — designs, one per phase, written before code
- `docs/superpowers/plans/` — implementation plans, task by task
- `CHANGELOG.md` — what each release changed, for users

Substantial work goes through the superpowers skills: brainstorming to a spec,
`writing-plans` to a plan, `subagent-driven-development` to execute it — one
implementer subagent per task, a review after each. A run's ledger lives at
`.superpowers/sdd/<plan-name>/progress.md`, which is **gitignored scratch and
dies with its worktree**; anything that must survive belongs in this file, the
spec or plan it concerns, or a code comment beside what it explains.

Isolated work happens in `.claude/worktrees/`, also gitignored.

## Releasing

```bash
pnpm test && pnpm typecheck && pnpm build
```

Bump `package.json` **and** `server.json` together, then:

```bash
npm publish
```

```bash
./mcp-publisher publish
```

The registry step needs `fibrous-mcp-key.pem` (gitignored, local only) and
proves ownership of `fibrous.finance` via DNS. The published name is
`finance.fibrous/fibx`; `package.json`'s `mcpName` must match `server.json`'s
`name` exactly.

## The ecosystem

Four repositories under `Fibrous-Finance`:

1. **fibx** — this one. CLI + stdio MCP server.
2. **fibx-server** — Hono, Privy proxy. Email OTP to an app-managed wallet with
   a server-side Privy signing policy, then an HS256 JWT. No database; Privy
   `custom_metadata` is the only datastore. On AWS App Runner.
3. **fibx-telegram-bot** — Telegraf, bring-your-own-key, one isolated MCP
   process per user.
4. **fibx-skills** — prompt-based `SKILL.md` files.
