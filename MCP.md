# MCP Server

fibx includes a built-in [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes all DeFi operations as callable tools. AI editors like **Cursor**, **Claude Desktop**, **Antigravity**, and any MCP-compatible client can connect to fibx and execute trades, transfers, and DeFi operations through natural language.

## Quick Start

```bash
npx fibx mcp-start
```

This starts an MCP server over **stdio** (standard input/output). The server speaks JSON-RPC 2.0 and is designed to be launched by an AI editor, not run manually.

## How It Works

1. Your AI editor spawns `npx fibx mcp-start` as a subprocess
2. The editor communicates via **stdin/stdout** using JSON-RPC 2.0 messages
3. fibx reads the local session file to authenticate (must run `fibx auth login` or `fibx auth import` first)
4. Tools are executed against live blockchains — transactional tools are marked as **destructive** so editors prompt for confirmation
5. The server sends built-in `MCP_INSTRUCTIONS` to guide AI agents on proper tool usage, chain selection, and error handling

> **Note:** stderr is used for logging (server banner, tool counts); stdout is reserved for JSON-RPC protocol messages.

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

> **Important:** You must be authenticated (`fibx auth login` or `fibx auth import`) before the MCP server can execute wallet operations.

## Available Tools (10)

### Read-Only (6 tools)

| Tool               | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| `get_auth_status`  | Check session and Fibrous API health                         |
| `get_balance`      | Get native and ERC-20 token balances                         |
| `get_portfolio`    | Cross-chain portfolio with USD valuations and DeFi positions |
| `get_tx_status`    | Check transaction receipt and status                         |
| `get_aave_status`  | Get Aave V3 position health on Base                          |
| `get_aave_markets` | List all Aave V3 reserves with APY, TVL, and LTV             |

### Transactional (3 tools)

These tools are marked as **destructive** — the AI editor will ask for confirmation before executing. All support `simulate=true` for fee estimation without execution.

| Tool          | Description                                             | Simulate |
| ------------- | ------------------------------------------------------- | -------- |
| `swap_tokens` | Swap tokens via Fibrous aggregator with optimal routing | ✅       |
| `send_tokens` | Send native or ERC-20 tokens to a recipient             | ✅       |
| `aave_action` | Supply, borrow, repay, or withdraw on Aave V3 (Base)    | ✅       |

### Utility (1 tool)

| Tool            | Description                                      |
| --------------- | ------------------------------------------------ |
| `config_action` | Set or view custom RPC URLs to avoid rate limits |

## Tool Details

### get_auth_status

Check whether fibx is authenticated and the Fibrous API is reachable. **Always call this first** before any transactional tool.

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

### get_portfolio

Get a consolidated portfolio across all chains with USD-valued token holdings and DeFi positions.

```
Input:  {}
Output: {
  wallet, totalUsd,
  chains: [{ chain, totalUsd, assets: [{ symbol, balance, price, usdValue }] }],
  defi: [{ protocol, chain, collateralUsd, debtUsd, healthFactor, netUsd }]
}
```

**Example prompt:** "Show me my portfolio" or "What's my total net worth across all chains?"

### swap_tokens

Execute a token swap through Fibrous. Handles approvals, simulation, and routing automatically.

```
Input:  { amount, from_token, to_token, chain?, slippage?, simulate? }
Output: { txHash, amountIn, amountOut, tokenIn, tokenOut, router, chain }
```

**Example prompt:** "Swap 0.1 ETH to USDC on Base" or "Simulate swapping 100 USDC to DAI"

### send_tokens

Transfer native or ERC-20 tokens. Simulates before executing.

```
Input:  { amount, recipient, token?, chain?, simulate? }
Output: { txHash, amount, token, recipient, chain }
```

**Example prompt:** "Send 50 USDC to 0x1234..." or "Simulate sending 0.1 ETH to 0x..."

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

### get_aave_markets

List all Aave V3 reserve markets on Base with live APY data. No wallet required.

```
Input:  {}
Output: { markets: [{ symbol, supplyAPY, borrowAPY, totalSupply, totalBorrow, ltv }] }
```

**Example prompt:** "What are the current Aave lending rates?" or "Show me Aave markets"

### aave_action

Execute an Aave V3 operation. Auto-handles ETH<->WETH wrapping. Use `"max"` as amount for full repay/withdraw.

```
Input:  { action: "supply" | "borrow" | "repay" | "withdraw", amount, token, simulate? }
Output: { action, amount, token, txHash, chain }
```

**Example prompt:** "Supply 0.5 ETH to Aave" or "Repay max USDC on Aave"

### config_action

Manage custom RPC URLs. Useful when encountering rate limits on public endpoints.

```
Input:  { action: "set-rpc" | "get-rpc" | "reset-rpc" | "list", chain?, url? }
Output: { action, chain?, url?, rpcUrls? }
```

**Example prompt:** "I'm getting rate limited on Base, set a custom RPC" or "Reset all RPCs to default"

## Error Handling

All tool errors are returned as structured JSON with `isError: true`:

```json
{
	"success": false,
	"error": "Not authenticated. Run `fibx auth login <email>` first.",
	"code": "NOT_AUTHENTICATED"
}
```

EVM-specific errors (reverts, gas estimation failures) are parsed and human-readable via the `parseEvmError` utility.

## Supported Chains

| Chain    | Native Token | Fibrous Network |
| -------- | ------------ | --------------- |
| Base     | ETH          | base            |
| Citrea   | cBTC         | citrea          |
| HyperEVM | HYPE         | hyperevm        |
| Monad    | MON          | monad           |

## Environment Variables

| Variable              | Description                                             | Required |
| --------------------- | ------------------------------------------------------- | -------- |
| `FIBX_API_URL`        | Custom fibx-server URL (for Privy wallet operations)    | No       |
| `FIBX_SESSION_SECRET` | Custom encryption key for session files (hex or string) | No       |

If using Privy authentication, ensure [fibx-server](https://github.com/ahmetenesdur/fibx-server) is running and accessible before starting the MCP server.

## Troubleshooting

| Problem                    | Solution                                                             |
| -------------------------- | -------------------------------------------------------------------- |
| Server won't start         | Ensure Node.js >= 18 is installed and `npx fibx --version` works     |
| "Not authenticated" errors | Run `fibx auth login <email>` or `fibx auth import` before starting  |
| Wallet operations fail     | Ensure `fibx-server` is running (not needed for private key imports) |
| Rate limit errors          | Use `config_action` tool to set a custom RPC URL                     |
| Editor can't connect       | Verify the MCP config JSON syntax and restart the editor             |
| Stale tool responses       | Config changes are auto-detected via hot-reload — no restart needed  |
