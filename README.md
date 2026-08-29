# FibX

A command-line tool for DeFi operations on **Base, HyperEVM, and Monad**, powered by [Fibrous](https://fibrous.finance) aggregation and [Privy](https://privy.io) Server Wallets.

[![npm version](https://badge.fury.io/js/fibx.svg)](https://badge.fury.io/js/fibx)

## Features

- **Multi-Chain Support**: Base, HyperEVM, and Monad
- **Portfolio**: Cross-chain portfolio overview with USD valuations and DeFi positions
- **Token Swaps**: Optimal routing via Fibrous aggregation with auto-slippage
- **Transfers**: Send ETH or any ERC-20 token
- **Aave V3**: Supply, borrow, repay, withdraw, and browse markets on Base
- **MCP Server**: Built-in AI agent integration for Cursor, Claude Desktop, and Antigravity (11 tools, 4 categories)
- **Agent Skills**: Prompt-based AI skills via [fibx-skills](https://github.com/Fibrous-Finance/fibx-skills)
- **Privy Server Wallets**: Server-side signing — the CLI receives signed transaction payloads or signatures, not Privy app credentials or raw keys
- **Policy-Enforced Signing**: Configured chain allowlists and native-value caps are evaluated by Privy at signing time
- **Private Key Import**: Use an existing wallet with AES-256-GCM encrypted local storage
- **Preflight Checks**: Transaction flows validate or estimate execution where the underlying RPC supports it
- **Dry‑Run Mode**: `--simulate` previews write operations without broadcasting; gas estimates are included where available
- **JSON Output**: `--json` flag for scripting and pipelines
- **Zero-Dependency Install**: Single-file bundle via tsup — `npx fibx` runs near-instantly

## Supported Chains

| Chain    | Native Token | Aave V3 |
| -------- | ------------ | ------- |
| Base     | ETH          | ✅      |
| HyperEVM | HYPE         | —       |
| Monad    | MON          | —       |

## Installation

Run directly with `npx` (no install needed):

```bash
npx fibx status
```

Or install globally:

```bash
npm install -g fibx
```

## Requirements

- Node.js >= 18
- A running [fibx-server](https://github.com/Fibrous-Finance/fibx-server) instance (required for Privy wallet operations; not needed for private key imports)

## Quick Start — First Swap in 3 Minutes

### Step 1: Get a Price Quote (no auth needed)

Try FibX instantly — no sign-up, no wallet, no keys:

```bash
npx fibx quote 0.01 ETH USDC              # Check price on Base
npx fibx quote 100 USDC DAI --chain base   # Compare pairs
npx fibx quote 0.5 MON USDC --chain monad  # Check Monad prices
```

### Step 2: Authenticate (pick one)

**Option A — Email Login** (Privy Server Wallet, no keys to manage):

```bash
npx fibx auth login you@email.com          # Sends OTP to your email
npx fibx auth verify you@email.com 123456  # Verify & create wallet
```

**Option B — Import Private Key** (use an existing wallet):

```bash
npx fibx auth import                       # Paste your key (encrypted at rest)
```

### Step 3: Execute

```bash
npx fibx trade 0.01 ETH USDC               # Execute the swap
npx fibx balance                            # Check your balances
```

That's it. Three steps from zero to first swap.

## Usage

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

> **Security:** When using `auth import`, your private key is encrypted at rest with AES-256-GCM. The encryption key is auto-generated per machine and stored in the OS config directory (e.g. `~/.config/fibx-nodejs/encryption-key` on Linux). You can also set the `FIBX_SESSION_SECRET` environment variable for CI/Docker environments.

### Connect your own wallet

```bash
npx fibx auth connect
```

Pairs FibX with a wallet you already have — MetaMask, Rabby, Rainbow, Phantom —
over WalletConnect. A QR code appears in the terminal; scan it with your phone.
Every transaction is then approved in your wallet, so the keys never leave it.

The chain you trade on must already be in your wallet, and it is approved when
you pair. If you try to sign on a chain the session does not carry, FibX stops
before contacting the wallet and names the chain: add it in your wallet, then run
`npx fibx auth connect` again so the new chain is included.

With `--json`, output is NDJSON — one JSON document per line, not one document
for the whole run: the pairing URI prints first as `{"uri":"wc:..."}` so a
script can act on it while it waits, then the result prints as its own compact
JSON line once the wallet approves.

`npx fibx auth logout` ends the connection on both sides: it tells your wallet to
drop the session, so FibX stops appearing in its connected-apps list, and removes
the pairing keys from disk along with the session.

A shared WalletConnect project id ships in the published bundle, so this works
with no setup. It is public by necessity — a CLI has no origin to allowlist — so
its only real exposure is quota consumed by third parties. If pairing starts
failing on quota, create a free project at
[cloud.reown.com](https://cloud.reown.com) and set `FIBX_WC_PROJECT_ID` to your
own id.

`auth login` (email OTP) and `auth import` (private key) are unchanged and remain
available.

### Signing policy

`fibx policy` bounds what FibX is allowed to sign, on top of whichever path
from the table above holds the key — a client-side cap evaluated before every
local-key, Privy, or WalletConnect transaction:

```bash
npx fibx policy show                    # Print the active policy

npx fibx policy set base.maxValue 0.05
npx fibx policy set allowedChains base,monad
npx fibx policy set expiry 2026-12-31

npx fibx policy clear base.maxValue     # Remove one rule
npx fibx policy clear                   # Remove the whole policy
```

A local policy guarding a local key is advisory: anything that can read the
key can edit the policy, so this is worth nothing against malware. What it
does bound is the agent — a model that misbehaves, or a prompt injection
telling it to. "Drain the wallet" hits the cap.

### Global Options

| Option               | Description                                          | Default |
| -------------------- | ---------------------------------------------------- | ------- |
| `-c, --chain <name>` | Target chain (`base`, `hyperevm`, `monad`) | `base`  |
| `--json`             | Output results as JSON                               | `false` |

### Balance

```bash
npx fibx balance
npx fibx balance --chain hyperevm
```

### Portfolio

Consolidated cross-chain portfolio view with USD valuations:

```bash
npx fibx portfolio           # Table output across all chains
npx fibx portfolio --json    # Structured JSON for scripting
```

Shows all token holdings across Base, HyperEVM, and Monad with USD values. Includes DeFi positions (Aave V3 collateral/debt) and total portfolio net worth. Token prices are sourced live from Fibrous.

### Send

```bash
npx fibx send 0.001 0xRecipient           # Send native token on Base (ETH)
npx fibx send 10 0xRecipient USDC         # Send ERC-20 on Base
npx fibx send 1 0xRecipient --chain monad # Send MON on Monad
npx fibx send 0.1 0xRecipient --simulate  # Preview without sending
```

### Quote

Get swap prices without authentication:

```bash
npx fibx quote 0.01 ETH USDC                  # Price check on Base
npx fibx quote 1 MON USDC --chain monad         # Check Monad prices
npx fibx quote 0.1 ETH USDC --json             # JSON output for scripts
```

> **No wallet or authentication required.** Use `quote` to explore prices, then `trade` to execute.

### Swap

```bash
npx fibx trade <amount> <from> <to>
npx fibx trade 0.0001 ETH USDC
npx fibx trade 20 USDC DAI
npx fibx trade 1 MON USDC --chain monad
npx fibx trade 0.1 ETH USDC --simulate   # Preview without broadcasting
```

Options: `--slippage <n>` (default: 0.5%), `--approve-max`, `--simulate`, `--json`

> **Note:** The `trade` command automatically detects **Wrap** (Native -> Wrapped) and **Unwrap** (Wrapped -> Native) operations and executes them directly via contract calls, bypassing aggregator routing to save gas.

### Transaction Status

```bash
npx fibx tx-status <hash>
npx fibx tx-status 0x123...abc --chain monad
```

### Wallet Info

```bash
npx fibx address    # Print active wallet address
npx fibx wallets    # Show active wallet details
```

### Aave V3 (Base)

```bash
npx fibx aave status               # Account health
npx fibx aave markets              # List all active reserves with APY & TVL
npx fibx aave supply 1 ETH         # Auto-wraps ETH -> WETH and supplies
npx fibx aave supply 100 USDC      # Supply ERC-20
npx fibx aave borrow 50 USDC       # Borrow
npx fibx aave repay 50 USDC        # Repay
npx fibx aave repay max ETH        # Auto-wraps ETH and repays full WETH debt
npx fibx aave withdraw max ETH     # Withdraws WETH and auto-unwraps to ETH
npx fibx aave supply 1 ETH --simulate  # Preview without broadcasting
```

> **Note:** `supply`, `repay`, and `withdraw` support automatic **ETH <-> WETH** wrapping/unwrapping on Base.

### Configuration

Set custom RPC URLs to avoid rate limits on public endpoints:

```bash
npx fibx config set-rpc base https://mainnet.base.org
npx fibx config get-rpc base
npx fibx config reset-rpc base   # Reset single chain to default
npx fibx config reset-rpc        # Reset all chains to default
npx fibx config list
```

> **Hot-reload:** Config changes are picked up automatically — no need to restart the CLI or MCP server.

## AI Agent Integration

### MCP Server

fibx includes a built-in [MCP](https://modelcontextprotocol.io) server for AI editors like Cursor, Claude Desktop, and Antigravity. See [MCP.md](https://github.com/Fibrous-Finance/fibx/blob/main/MCP.md) for setup and available tools.

```bash
npx fibx mcp-start
```

The MCP server exposes **11 tools** across 4 categories (Auth & Config, Wallet & Portfolio, Trading, DeFi). All write operations support a `simulate=true` preview that does not broadcast; gas estimates are returned only where available.

### Agent Skills

For prompt-based agent integration (Claude Code, Cursor, etc.), see the [fibx-skills](https://github.com/Fibrous-Finance/fibx-skills) repository.

## Security

Letting an AI agent operate a wallet requires controls outside the model.
fibx combines signing-layer policies, server-side validation, client hints, and
explicit previews. These controls reduce risk, but the server credentials, MCP
client configuration, and deployment policy remain part of the trust boundary:

| Layer                | What it does                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Privy signing policy | The default policy allowlists configured chains, caps each transaction's native-token `value`, and denies key export. Privy evaluates the policy at signing time; fibx-server credentials and any custom policy remain critical trust boundaries. |
| fibx-server schemas  | `/sign/*` accepts only the exact transaction shape the CLI produces — unknown fields, contract creation, and unserved chains are rejected before reaching Privy.                                                                                  |
| MCP tool annotations | Every transactional tool advertises `destructiveHint: true`; compatible clients may use that hint to request confirmation, depending on client behavior and configuration.                                                                        |
| Simulation           | `--simulate` previews write operations without broadcasting. Some paths also return a gas estimate; others return operation metadata only.                                                                                                        |
| Local key storage    | Imported private keys are encrypted at rest with AES-256-GCM using a per-machine key stored `0600` in the OS config directory.                                                                                                                    |

Wallet policy limits are configured per deployment — see the
[fibx-server wallet policy docs](https://github.com/Fibrous-Finance/fibx-server#wallet-policy-privy-signing-layer).

> **Note:** policies are attached when a wallet is created. Wallets provisioned
> before policies were introduced keep signing without them until migrated.

## Architecture

This repository is the CLI and MCP server. Three sibling repositories complete
the stack:

| Repository                                                                | Role                                                                                                             |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **fibx** (this repo)                                                      | CLI + stdio MCP server, shipped as a single dependency-free bundle                                               |
| [fibx-server](https://github.com/Fibrous-Finance/fibx-server)             | Hono backend that proxies Privy — holds the app secret so the CLI never does, and owns the wallet signing policy |
| [fibx-skills](https://github.com/Fibrous-Finance/fibx-skills)             | Prompt-based Agent Skills for Claude Code, Cursor, and other skill-aware agents                                  |
| [fibx-telegram-bot](https://github.com/Fibrous-Finance/fibx-telegram-bot) | Telegram bot that drives this CLI over MCP, with one process and separate config paths per active user           |

```
src/
├── commands/           # CLI commands (auth, trade, send, aave, config)
├── mcp/                # Modular MCP server
│   ├── server.ts       # Entry point + MCP_INSTRUCTIONS
│   ├── tools/          # Tool registrations (auth, wallet, trade, defi)
│   └── handlers/       # Tool implementations
├── services/           # Business logic (chain, fibrous, auth, defi, portfolio)
└── lib/                # Shared utilities (errors, fetch, format, crypto)
```

## Development

```bash
pnpm install
pnpm dev          # run the CLI from source
pnpm test         # vitest unit tests
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm build        # tsup bundle to dist/
```

## Related Links

- [Fibrous Finance](https://fibrous.finance) — DEX aggregator powering swaps
- [npm package](https://www.npmjs.com/package/fibx)

## License

[MIT](https://opensource.org/licenses/MIT)
