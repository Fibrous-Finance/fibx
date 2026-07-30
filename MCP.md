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
3. Wallet-dependent tools read the local session file; public tools such as quotes, transaction status, and Aave markets do not require one
4. Tools are executed against live blockchains — transactional tools advertise `destructiveHint: true`, which clients may use to request confirmation
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

## Available Tools (11)

### Read-Only (7 tools)

| Tool               | Description                                                  | Auth Required |
| ------------------ | ------------------------------------------------------------ | ------------- |
| `get_quote`        | Get swap price quote, exchange rate, and route info          | No            |
| `get_auth_status`  | Check session and Fibrous API health                         | No            |
| `get_balance`      | Get native and ERC-20 token balances                         | Yes           |
| `get_portfolio`    | Cross-chain portfolio with USD valuations and DeFi positions | Yes           |
| `get_tx_status`    | Check transaction receipt and status                         | No            |
| `get_aave_status`  | Get Aave V3 position health on Base                          | Yes           |
| `get_aave_markets` | List all Aave V3 reserves with APY, TVL, and LTV             | No            |

### Transactional (3 tools)

These tools advertise `destructiveHint: true`; confirmation behavior depends on the MCP client and its configuration. All support `simulate=true` for a no-broadcast preview, with gas estimates returned only where available.

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

### get_quote

Get a price quote for a token swap. **No authentication required** — use this to check prices before setting up a wallet.

```
Input:  { amount, from_token, to_token, chain?, slippage? }
Routed output: { input, output, rate, slippage, router, chain }
Wrap/unwrap output: { input, output, rate, operation, chain }
```

Direct native/wrapped-native quotes are 1:1 conversions and therefore omit
aggregator-specific `slippage` and `router` fields. Executing the conversion
still requires native gas.

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

Execute a token swap through Fibrous. Handles approvals and routing automatically, and supports an explicit no-broadcast preview.

```
Input:  { amount, from_token, to_token, chain?, slippage?, simulate? }
Execution output: { txHash, amountIn, amountOut, tokenIn, tokenOut, router, chain, explorer? }
Preview output:   { success, mode, amountIn, amountOut, tokenIn, tokenOut, router?, chain, estimatedGas?, requiresApproval? }
```

An ERC-20 preview with insufficient allowance reports
`requiresApproval: true` without broadcasting an approval; in that case it
does not claim a swap gas estimate. Wrap/unwrap previews are request metadata
only.

**Example prompt:** "Swap 0.1 ETH to USDC on Base" or "Simulate swapping 100 USDC to DAI"

### send_tokens

Transfer native or ERC-20 tokens, with an optional no-broadcast preview.

```
Input:  { amount, recipient, token?, chain?, simulate? }
Execution output: { txHash, amount, token, recipient, chain, explorer? }
Preview output:   { success, mode, amount, token, recipient, chain, estimatedGas? }
```

Native-token previews include gas units. ERC-20 previews validate the contract
call but currently do not return a gas estimate.

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
Output: {
  chain, marketCount,
  markets: [{ symbol, supplyAPY, borrowAPY, totalSupply, totalBorrow, ltv, isFrozen }]
}
```

**Example prompt:** "What are the current Aave lending rates?" or "Show me Aave markets"

### aave_action

Execute an Aave V3 operation. ETH supply/repay can auto-wrap and ETH withdraw
can auto-unwrap; borrowing the ETH market returns WETH. Use `"max"` only for
full repay/withdraw.

```
Input:  { action: "supply" | "borrow" | "repay" | "withdraw", amount, token, simulate? }
Execution output: { action, amount, token, txHash?, status?, chain, explorer? }
Preview output:   { success, mode, action, amount, token, chain, note }
```

The preview validates the amount, resolves the token, and describes the
requested operation. It does not run an on-chain simulation or gas estimate.

**Example prompt:** "Supply 0.5 ETH to Aave" or "Repay max USDC on Aave"

### config_action

Manage custom RPC URLs. Useful when encountering rate limits on public endpoints.

```
Input:  { action: "set-rpc" | "get-rpc" | "reset-rpc" | "list", chain?, url? }
Output: { action, chain?, url?, rpcUrls? }
```

**Example prompt:** "I'm getting rate limited on Base, set a custom RPC" or "Reset all RPCs to default"

## Safety

Tools that move value advertise `destructiveHint: true`. MCP clients may use
that hint to request confirmation, but behavior depends on the client and its
configuration:

- **Preview first.** Every transactional tool accepts `simulate=true` for a
  no-broadcast preview. Gas estimates are included only on paths that can
  calculate them safely.
- **Limits sit below the model.** The default Privy wallet policy allowlists
  configured chains, caps each transaction's native-token `value`, and denies
  key export. `fibx-server` also validates transaction shape. Server credentials
  and custom policy configuration remain part of the trust boundary.
- **Read-only tools need no wallet.** `get_quote`, `get_tx_status`, and
  `get_aave_markets` work with no session at all, so an agent can explore
  prices and rates before any wallet exists.

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

If using Privy authentication, ensure [fibx-server](https://github.com/Fibrous-Finance/fibx-server) is running and accessible before starting the MCP server.

## Troubleshooting

| Problem                    | Solution                                                             |
| -------------------------- | -------------------------------------------------------------------- |
| Server won't start         | Ensure Node.js >= 18 is installed and `npx fibx --version` works     |
| "Not authenticated" errors | Run `fibx auth login <email>` or `fibx auth import` before starting  |
| Wallet operations fail     | Ensure `fibx-server` is running (not needed for private key imports) |
| Rate limit errors          | Use `config_action` tool to set a custom RPC URL                     |
| Editor can't connect       | Verify the MCP config JSON syntax and restart the editor             |
| Stale tool responses       | Config changes are auto-detected via hot-reload — no restart needed  |
