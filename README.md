# fibx

A command-line tool for DeFi operations on **Base, Citrea, HyperEVM, and Monad**, powered by [Fibrous](https://fibrous.finance) aggregation and [Privy](https://privy.io) Server Wallets.

[![npm version](https://badge.fury.io/js/fibx.svg)](https://badge.fury.io/js/fibx)

## Features

- **Multi-Chain Support**: Base, Citrea, HyperEVM, and Monad
- **Portfolio**: Cross-chain portfolio overview with USD valuations and DeFi positions
- **Token Swaps**: Optimal routing via Fibrous aggregation with auto-slippage
- **Transfers**: Send ETH or any ERC-20 token
- **Aave V3**: Supply, borrow, repay, withdraw, and browse markets on Base
- **MCP Server**: Built-in AI agent integration for Cursor, Claude Desktop, and Antigravity
- **Agent Skills**: Prompt-based AI skills via [fibx-skills](https://github.com/Fibrous-Finance/fibx-skills)
- **Privy Server Wallets**: Secure server-side signing — private keys never leave Privy's TEE
- **Private Key Import**: Use an existing wallet for local execution
- **Simulation**: All transactions are simulated before execution
- **Dry‑Run Mode**: `--simulate` flag estimates gas without sending a transaction
- **JSON Output**: `--json` flag for scripting and pipelines

## Supported Chains

| Chain    | Native Token | Aave V3 |
| -------- | ------------ | ------- |
| Base     | ETH          | ✅      |
| Citrea   | cBTC         | —       |
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
- A running [fibx-server](https://github.com/ahmetenesdur/fibx-server) instance (required for Privy wallet operations; not needed for private key imports)

## Usage

### Authentication

```bash
# Email OTP (uses Privy server wallet)
npx fibx auth login user@example.com
npx fibx auth verify user@example.com 123456

# Or import a private key (local signing, no server needed)
npx fibx auth import

# Check session status
npx fibx status

# Logout
npx fibx auth logout
```

### Global Options

| Option               | Description                                          | Default |
| -------------------- | ---------------------------------------------------- | ------- |
| `-c, --chain <name>` | Target chain (`base`, `citrea`, `hyperevm`, `monad`) | `base`  |
| `--json`             | Output results as JSON                               | `false` |

### Balance

```bash
npx fibx balance
npx fibx balance --chain citrea
```

### Portfolio

Consolidated cross-chain portfolio view with USD valuations:

```bash
npx fibx portfolio           # Table output across all chains
npx fibx portfolio --json    # Structured JSON for scripting
```

Shows all token holdings across Base, Citrea, HyperEVM, and Monad with USD values. Includes DeFi positions (Aave V3 collateral/debt) and total portfolio net worth. Token prices are sourced live from Fibrous.

### Send

```bash
npx fibx send 0.001 0xRecipient           # Send native token on Base (ETH)
npx fibx send 10 0xRecipient USDC         # Send ERC-20 on Base
npx fibx send 1 0xRecipient --chain monad # Send MON on Monad
npx fibx send 0.1 0xRecipient --simulate  # Estimate gas without sending
```

### Swap

```bash
npx fibx trade <amount> <from> <to>
npx fibx trade 0.0001 ETH USDC
npx fibx trade 20 USDC DAI
npx fibx trade 1 MON USDC --chain monad
npx fibx trade 0.1 ETH USDC --simulate   # Estimate gas without executing
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
npx fibx aave supply 1 ETH --simulate  # Estimate gas without executing
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

## AI Agent Integration

### MCP Server

fibx includes a built-in [MCP](https://modelcontextprotocol.io) server for AI editors like Cursor, Claude Desktop, and Antigravity. See [MCP.md](MCP.md) for setup and available tools.

```bash
npx fibx mcp-start
```

### Agent Skills

For prompt-based agent integration (Claude Code, Cursor, etc.), see the [fibx-skills](https://github.com/Fibrous-Finance/fibx-skills) repository.

## Related Links

- [Fibrous Finance](https://fibrous.finance) — DEX aggregator powering swaps
- [fibx-server](https://github.com/ahmetenesdur/fibx-server) — Backend for Privy wallet operations
- [fibx-skills](https://github.com/Fibrous-Finance/fibx-skills) — AI agent skills
- [npm package](https://www.npmjs.com/package/fibx)

## License

[MIT](https://opensource.org/licenses/MIT)
