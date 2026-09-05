# FibX

A zero-runtime-dependency CLI and stdio MCP server for DeFi on Base, HyperEVM
and Monad — swaps and quotes through Fibrous aggregation, transfers, portfolio,
Aave V3. One published artifact serves both surfaces: `fibx <command>` for
people, `fibx mcp-start` for agents.

**Start here when resuming work:** `docs/superpowers/HANDOFF.md` — what is in
flight, what is blocked on a human, and how to pick it up.

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

**`maxValue` bounds native value only.** An ERC-20 transfer reaches the policy
as `{ to: <the token contract>, value: 0n }`, so the cap never sees the amount.
`allowedDestinations` is what bounds where tokens may go. The README claimed
otherwise once and it had to be corrected; do not reintroduce the claim.

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

## How work is done here

Design and planning artifacts live in git and are meant to be read:

- `docs/superpowers/specs/` — designs, one per phase, written before code
- `docs/superpowers/plans/` — implementation plans, task by task
- `docs/superpowers/HANDOFF.md` — the live state

Substantial work goes through the superpowers skills: brainstorming to a spec,
`writing-plans` to a plan, `subagent-driven-development` to execute it — one
implementer subagent per task, a review after each. A run's ledger lives at
`.superpowers/sdd/<plan-name>/progress.md`, which is **gitignored scratch and
dies with its worktree**; anything that must survive belongs in `HANDOFF.md`.

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

Citrea was delisted by Fibrous on 2026-08-10 and withdrawn from all four on
2026-08-29. The pattern to follow for a delisting: the code stays, the offer is
withdrawn — `CHAIN_NAMES` is a literal (zod's `z.enum` needs a tuple type),
`SUPPORTED_CHAINS` keeps every row, and `getChainConfig` gates on what is
offered.
