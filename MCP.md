# MCP Server

fibx includes a built-in [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes all DeFi operations as callable tools. AI editors like **Cursor**, **Claude Desktop**, **Antigravity**, and any MCP-compatible client can connect to fibx and execute trades, transfers, and DeFi operations through natural language.

## Quick Start

```bash
npx fibx mcp-start
```

This starts an MCP server over **stdio** (standard input/output). The server speaks JSON-RPC and is designed to be launched by an AI editor, not run manually.

## Editor Setup

### Cursor

Create `.cursor/mcp.json` in your project root:

```json
{
	"mcpServers": {
		"fibx": {
			"command": "npx",
			"args": ["-y", "fibx", "mcp-start"]
		}
	}
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
	"mcpServers": {
		"fibx": {
			"command": "npx",
			"args": ["-y", "fibx", "mcp-start"]
		}
	}
}
```

### Antigravity

Add to `~/.gemini/antigravity/mcp_config.json`:

```json
{
	"mcpServers": {
		"fibx": {
			"command": "npx",
			"args": ["-y", "fibx", "mcp-start"]
		}
	}
}
```

> **Note:** You must be authenticated (`fibx auth login` or `fibx auth import`) before the MCP server can execute wallet operations.

## Available Tools

### Read-Only

| Tool              | Description                          |
| ----------------- | ------------------------------------ |
| `get_auth_status` | Check session and Fibrous API health |
| `get_balance`     | Get native and ERC-20 token balances |
| `get_tx_status`   | Check transaction receipt and status |
| `get_aave_status` | Get Aave V3 position health on Base  |

### Transactional

These tools are marked as **destructive** — the AI editor will ask for confirmation before executing.

| Tool          | Description                                             |
| ------------- | ------------------------------------------------------- |
| `swap_tokens` | Swap tokens via Fibrous aggregator with optimal routing |
| `send_tokens` | Send native or ERC-20 tokens to a recipient             |
| `aave_action` | Supply, borrow, repay, or withdraw on Aave V3 (Base)    |

### Utility

| Tool            | Description                                      |
| --------------- | ------------------------------------------------ |
| `config_action` | Set or view custom RPC URLs to avoid rate limits |

## Tool Details

### get_auth_status

Check whether fibx is authenticated and the Fibrous API is reachable.

```
Input:  { chain?: "base" | "citrea" | "hyperevm" | "monad" }
Output: { authenticated, walletAddress, sessionType, chain, fibrousStatus }
```

### get_balance

Fetch all token balances for the active wallet. Only returns non-zero balances.

```
Input:  { chain?: "base" | "citrea" | "hyperevm" | "monad" }
Output: { wallet, chain, balances: { "ETH": "0.5", "USDC": "100.0", ... } }
```

### swap_tokens

Execute a token swap through Fibrous. Handles approvals, simulation, and routing automatically.

```
Input:  { amount, from_token, to_token, chain?, slippage? }
Output: { txHash, amountIn, amountOut, tokenIn, tokenOut, router, chain }
```

**Example prompt:** "Swap 0.1 ETH to USDC on Base"

### send_tokens

Transfer native or ERC-20 tokens. Simulates before executing.

```
Input:  { amount, recipient, token?, chain? }
Output: { txHash, amount, token, recipient, chain }
```

**Example prompt:** "Send 50 USDC to 0x1234..."

### get_tx_status

Look up a transaction receipt by hash.

```
Input:  { hash, chain? }
Output: { hash, status, blockNumber, from, to, gasUsed, chain }
```

### get_aave_status

Get Aave V3 account health on Base.

```
Input:  {}
Output: { wallet, healthFactor, totalCollateralUSD, totalDebtUSD, availableBorrowsUSD }
```

### aave_action

Execute an Aave V3 operation. Auto-handles ETH<->WETH wrapping. Use `"max"` as amount for full repay/withdraw.

```
Input:  { action: "supply" | "borrow" | "repay" | "withdraw", amount, token }
Output: { action, amount, token, txHash, chain }
```

**Example prompt:** "Supply 0.5 ETH to Aave" or "Repay max USDC on Aave"

### config_action

Manage custom RPC URLs. Useful when encountering rate limits on public endpoints.

```
Input:  { action: "set-rpc" | "get-rpc" | "list", chain?, url? }
Output: { action, chain?, url?, rpcUrls? }
```

**Example prompt:** "I'm getting rate limited on Base, set a custom RPC"

## Supported Chains

| Chain    | Native Token | Fibrous Network |
| -------- | ------------ | --------------- |
| Base     | ETH          | base            |
| Citrea   | cBTC         | citrea          |
| HyperEVM | HYPE         | hyperevm        |
| Monad    | MON          | monad           |

## Environment Variables

| Variable       | Description                                          |
| -------------- | ---------------------------------------------------- |
| `FIBX_API_URL` | Custom fibx-server URL (for Privy wallet operations) |

If using Privy authentication, ensure `fibx-server` is running and accessible before starting the MCP server.
