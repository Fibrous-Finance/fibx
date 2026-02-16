# fibx

A command-line tool for DeFi operations on **Base, Citrea, HyperEVM, and Monad**, powered by [Fibrous](https://fibrous.finance) aggregation and [Privy](https://privy.io) Server Wallets.

[![npm version](https://badge.fury.io/js/fibx.svg)](https://badge.fury.io/js/fibx)

## Features

- **Multi-Chain Support**: Base, Citrea, HyperEVM, and Monad
- **Token Swaps**: Optimal routing via Fibrous aggregation with auto-slippage
- **Transfers**: Send ETH or any ERC-20 token
- **Aave V3**: Supply, borrow, repay, and withdraw on Base
- **Privy Server Wallets**: Secure server-side signing via [fibx-server](https://github.com/ahmetenesdur/fibx-server)
- **Private Key Import**: Use an existing wallet for local execution
- **Simulation**: All transactions are simulated before execution
- **JSON Output**: `--json` flag for scripting and pipelines

## Architecture

```
┌────────────┐         ┌──────────────┐         ┌─────────┐
│   fibx     │  HTTP   │  fibx-server │  SDK    │  Privy  │
│   (CLI)    │ ──────► │  (Backend)   │ ──────► │   API   │
│            │  JWT    │              │         │         │
└────────────┘         └──────────────┘         └─────────┘
```

The CLI handles user interaction and blockchain operations. The backend handles Privy operations (auth, wallets, signing) — Privy credentials never leave the server.

## Requirements

- Node.js >= 18
- A running [fibx-server](https://github.com/ahmetenesdur/fibx-server) instance

## Quick Start

### Backend

```bash
git clone https://github.com/ahmetenesdur/fibx-server.git
cd fibx-server
pnpm install
cp .env.example .env   # Fill in PRIVY_APP_ID, PRIVY_APP_SECRET, JWT_SECRET
pnpm dev
```

### CLI

```bash
# No install needed
npx fibx <command>

# Or install globally
npm install -g fibx
```

By default, the CLI connects to `http://localhost:3001`. To use a deployed backend:

```bash
export FIBX_API_URL="https://your-fibx-server.vercel.app"
```

### Authentication

```bash
# Email OTP
npx fibx auth login user@example.com
npx fibx auth verify user@example.com 123456

# Or import a private key
npx fibx auth import

# Logout
npx fibx auth logout

# Check status
npx fibx status
```

## Usage

### Global Options

Use `-c` or `--chain` to specify the target chain. Default is `base`.

Supported: `base`, `citrea`, `hyperevm`, `monad`

### Balance

```bash
npx fibx balance
npx fibx balance --chain citrea
```

### Send

```bash
npx fibx send 0.001 0xRecipient           # Send ETH
npx fibx send 10 0xRecipient USDC         # Send ERC-20
npx fibx send 1 0xRecipient --chain monad # Send on Monad
```

### Swap

```bash
npx fibx trade <amount> <from> <to>
npx fibx trade 0.0001 ETH USDC
npx fibx trade 20 USDC DAI
npx fibx trade 1 MON USDC --chain monad
```

Options: `--slippage <n>` (default: 0.5%), `--approve-max`, `--json`

### Transaction Status

```bash
npx fibx tx-status <hash>
npx fibx tx-status 0x123...abc --chain monad
```

### Wallet Info

```bash
npx fibx address              # Print wallet address
npx fibx wallets <email>      # List active wallet
```

### Aave V3 (Base)

```bash
npx fibx aave status                # Account health
npx fibx aave supply 100 USDC      # Deposit
npx fibx aave borrow 50 USDC       # Borrow
npx fibx aave repay max USDC       # Repay all
npx fibx aave withdraw max USDC    # Withdraw all
```

## Agent Skills

For AI agent integration, see the [fibx-skills](./fibx-skills) directory.

## Development

```bash
git clone https://github.com/ahmetenesdur/fibx.git
cd fibx
pnpm install
cp .env.example .env
```

| Script           | Description                        |
| ---------------- | ---------------------------------- |
| `pnpm dev <cmd>` | Run a command in development mode  |
| `pnpm build`     | Compile TypeScript to `dist/`      |
| `pnpm typecheck` | Run type checking without emitting |
| `pnpm lint`      | Lint source files with ESLint      |
| `pnpm format`    | Format code with Prettier          |
