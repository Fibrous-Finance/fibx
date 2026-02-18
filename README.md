# fibx

A command-line tool for DeFi operations on **Base, Citrea, HyperEVM, and Monad**, powered by [Fibrous](https://fibrous.finance) aggregation and [Privy](https://privy.io) Server Wallets.

[![npm version](https://badge.fury.io/js/fibx.svg)](https://badge.fury.io/js/fibx)

## Features

- **Multi-Chain Support**: Base, Citrea, HyperEVM, and Monad
- **Token Swaps**: Optimal routing via Fibrous aggregation with auto-slippage
- **Transfers**: Send ETH or any ERC-20 token
- **Aave V3**: Supply, borrow, repay, and withdraw on Base
- **Privy Server Wallets**: Secure server-side signing
- **Private Key Import**: Use an existing wallet for local execution
- **Simulation**: All transactions are simulated before execution
- **JSON Output**: `--json` flag for scripting and pipelines

## Requirements

- Node.js >= 18
- A running [fibx-server](https://github.com/ahmetenesdur/fibx-server) instance

## Usage

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
npx fibx send 0.001 0xRecipient           # Send native token on Base (ETH)
npx fibx send 10 0xRecipient USDC         # Send ERC-20 on Base
npx fibx send 1 0xRecipient --chain monad # Send on Monad native token (MON)
```

### Swap

```bash
npx fibx trade <amount> <from> <to>
npx fibx trade 0.0001 ETH USDC
npx fibx trade 20 USDC DAI
npx fibx trade 1 MON USDC --chain monad
```

Options: `--slippage <n>` (default: 0.5%), `--approve-max`, `--json`

> **Note:** The `trade` command automatically detects **Wrap** (Native -> Wrapped) and **Unwrap** (Wrapped -> Native) operations and executes them directly via contract calls, bypassing aggregator routing to save gas.

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
npx fibx aave status               # Account health
npx fibx aave supply 1 ETH         # Auto-wraps ETH -> WETH and supplies
npx fibx aave supply 100 USDC      # Supply ERC-20
npx fibx aave borrow 50 USDC       # Borrow
npx fibx aave repay 50 USDC        # Repay
npx fibx aave repay max ETH        # Auto-wraps ETH and repays full WETH debt
npx fibx aave withdraw max ETH     # Withdraws WETH and auto-unwraps to ETH
```

> **Note:** `supply`, `repay`, and `withdraw` support automatic **ETH <-> WETH** wrapping/unwrapping on Base.

## Agent Skills

For AI agent integration, see the [fibx-skills](https://github.com/Fibrous-Finance/fibx-skills) directory.
