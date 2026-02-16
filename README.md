# fibx

A command-line tool for specialized DeFi operations on **Base, Citrea, HyperEVM, and Monad**, powered by [Fibrous](https://fibrous.finance) aggregation and [Privy](https://privy.io) Server Wallets.

[![npm version](https://badge.fury.io/js/fibx.svg)](https://badge.fury.io/js/fibx)

## Features

- **Privy Server Wallets**: Uses "Agentic" server-side wallets (ownerless) for seamless, automated signing without user interaction.
- **Multi-Chain Support**: seamlessly interact with Base, Citrea, HyperEVM, and Monad.
- **Native & ERC-20 Transfers**: Send ETH, MON, cBTC, HYPE, or any ERC-20 token with a single command.
- **Fibrous Aggregation**: Execute token swaps with optimal routing and auto-slippage protection.
- **Transaction Status**: Check the status of any transaction hash and get a block explorer link.
- **Aave V3 Integration**: Supply, borrow, repay, and withdraw assets on Base (DeFi).
- **Automated Auth Flow**: One-time email OTP login provisions a persistent server wallet linked to your user profile.
- **Private Key Import**: Support for importing existing private keys for local execution.
- **Automated Simulation**: All transactions (send, swap, Aave) are simulated on-chain before execution to prevent failures.
- **JSON Output**: All commands support `--json` for easy integration into scripts and pipelines.

## Requirements

- Node.js ≥ 18
- npm (or any Node.js package manager)
- Privy App ID and Secret (from [dashboard.privy.io](https://dashboard.privy.io))

## Quick Start

### 1. Installation

You can use `fibx` without installation via `npx`, or install it globally.

**Option A: No Installation (Recommended for Agents)**

```bash
npx fibx <command>
```

**Option B: Global Install**

```bash
npm install -g fibx
fibx <command>
```

Set your Privy credentials as environment variables:

```bash
export PRIVY_APP_ID="your_app_id"
export PRIVY_APP_SECRET="your_app_secret"
```

### 2. Authenticate & Provision Wallet

This two-step process links your email to a server-side wallet.

**Step 1: Request OTP**

```bash
npx fibx auth login <email>
# Example:
npx fibx auth login user@example.com
```

**Step 2: Verify & Create Session**

```bash
npx fibx auth verify <email> <code>
# Example:
npx fibx auth verify user@example.com 123456
```

_Successfully verifying will create a local session file and provision a Server Wallet if one doesn't exist._

### 3. Alternative: Import Private Key

If you prefer to use an existing private key (e.g., from Metamask or a generated wallet) instead of Privy:

```bash
npx fibx auth import
```

_This will securely prompt for your private key and store it locally in `session.json` for signing transactions._

> **Security Note:** Your private key is stored locally on your machine. Ensure your environment is secure.

### 4. Logout

If you want to clear your local session:

```bash
npx fibx auth logout
```

### 5. Check Status

Verify that you are authenticated and the API is healthy:

```bash
npx fibx status
```

## Usage

### Global Options

You can specify the target chain for any command using the `-c` or `--chain` flag.

**Supported Chains:** `base` (default), `citrea`, `hyperevm`, `monad`

```bash
npx fibx status --chain monad
```

### Check Balance

View your balances on the selected chain:

```bash
npx fibx balance
npx fibx balance --chain citrea
```

### Send Tokens

Transfer ETH or ERC-20 tokens to another address.

**Send ETH (Default):**

```bash
npx fibx send 0.001 0xRecipientAddress
npx fibx send 1 0xRecipientAddress --chain monad
```

**Send ERC-20 (e.g., USDC):**

```bash
npx fibx send 10 0xRecipientAddress USDC
```

### Swap Tokens

Swap tokens using Fibrous Finance's aggregator.

```bash
npx fibx trade <amount> <from_token> <to_token>
```

**Examples:**

```bash
# Swap 0.0001 ETH to USDC
npx fibx trade 0.0001 ETH USDC

# Swap 20 USDC to DAI on Base
npx fibx trade 20 USDC DAI

# Swap on Monad (native token handled automatically)
npx fibx trade 1 MON USDC --chain monad
```

**Options:**

- `--slippage <number>`: Set slippage tolerance (default: 0.5%)
- `--approve-max`: Approve maximum amount (infinite approval) instead of exact amount (default: false)
- `--json`: Output result as JSON

### Check Transaction Status

Check the status of a transaction and get the explorer link.

```bash
npx fibx tx-status <hash>
# Example:
npx fibx tx-status 0x123...abc
npx fibx tx-status 0x456...def --chain monad
```

### View Wallet Address

Print your connected wallet address (Privy or Local):

```bash
npx fibx address
```

### List Wallets (Privy)

List all wallets linked to a Privy user email:

```bash
npx fibx wallets <email>
```

### Aave V3 (Base Only)

Interact with the Aave V3 lending protocol on the Base network.

```bash
npx fibx aave <action> [amount] [token]
```

**Actions:**

- `status`: Check account health (Health Factor, LTV, Net Worth)
- `supply`: Deposit assets to earn yield
- `borrow`: Borrow assets (requires collateral)
- `repay`: Repay debt (use `max` as amount to repay all)
- `withdraw`: Withdraw assets (use `max` as amount to withdraw all)

**Examples:**

```bash
npx fibx aave status
npx fibx aave supply 100 USDC
npx fibx aave repay max USDC
npx fibx aave withdraw max USDC
```

## Agent Skills

Building an AI Agent? We provide a **Standardized Skill Set** optimized for LLMs.

Check out the [fibx-skills](./fibx-skills) directory for:

- **authenticate-wallet** — Email OTP login and private key import
- **balance** — Check wallet balances on any supported chain
- **send** — Send ETH or ERC-20 tokens
- **trade** — Swap tokens via Fibrous aggregation
- **aave** — Manage Aave V3 positions (Supply, Borrow, Repay, Withdraw)
- **tx-status** — Verify transaction status and get explorer links

## Development

```bash
git clone https://github.com/ahmetenesdur/fibx.git
cd fibx
pnpm install
cp .env.example .env   # Add your PRIVY_APP_ID and PRIVY_APP_SECRET
```

**Available Scripts:**

| Script           | Description                        |
| ---------------- | ---------------------------------- |
| `pnpm dev <cmd>` | Run a command in development mode  |
| `pnpm build`     | Compile TypeScript to `dist/`      |
| `pnpm typecheck` | Run type checking without emitting |
| `pnpm lint`      | Lint source files with ESLint      |
| `pnpm format`    | Format code with Prettier          |

## Architecture

This CLI uses a **Hybrid Wallet** architecture:

1.  **Authentication**:
    - **Privy**: Uses "Agentic" server-side wallets (ownerless) for automated signing.
    - **Local Key**: Direct private key import for standard execution without external dependencies.
2.  **Viem**: Handles all blockchain interactions (RPC calls, transaction signing) using a unified `WalletClient` interface, abstracting away the underlying signer (Privy vs. Local).
3.  **Fibrous**: Provides the routing and calldata for optimal token swaps on all supported chains, encapsulated in the `services/fibrous` module.
