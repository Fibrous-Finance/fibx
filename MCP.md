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

> **Important:** You must be authenticated before the MCP server can execute wallet
> operations. Run `fibx auth setup` to choose a signing path, or `fibx auth connect` /
> `fibx auth login <email>` / `fibx auth import` directly.

## Available Tools (17)

### Read-Only (9 tools)

| Tool                 | Description                                                  | Auth Required |
| -------------------- | ------------------------------------------------------------ | ------------- |
| `get_quote`          | Get swap price quote, exchange rate, and route info          | No            |
| `get_auth_status`    | Check session and Fibrous API health                         | No            |
| `get_connect_status` | Poll a pairing started by connect_wallet                     | No            |
| `get_balance`        | Get native and ERC-20 token balances                         | Yes           |
| `get_portfolio`      | Cross-chain portfolio with USD valuations and DeFi positions | Yes           |
| `get_tx_status`      | Check transaction receipt and status                         | No            |
| `get_aave_status`    | Get Aave V3 position health on Base                          | Yes           |
| `get_aave_markets`   | List all Aave V3 reserves with APY, TVL, and LTV             | No            |
| `get_policy`         | Read the local signing policy that bounds every transaction  | No            |

### Transactional (3 tools)

These tools advertise `destructiveHint: true`; confirmation behavior depends on the MCP client and its configuration. All support `simulate=true` for a no-broadcast preview, with gas estimates returned only where available.

| Tool          | Description                                             | Simulate |
| ------------- | ------------------------------------------------------- | -------- |
| `swap_tokens` | Swap tokens via Fibrous aggregator with optimal routing | ✅       |
| `send_tokens` | Send native or ERC-20 tokens to a recipient             | ✅       |
| `aave_action` | Supply, borrow, repay, or withdraw on Aave V3 (Base)    | ✅       |

### Session & Configuration (5 tools)

These change local state rather than chain state, and all advertise
`readOnlyHint: false`. `set_policy_rule`, `clear_policy_rule`, and `logout`
also advertise `destructiveHint: true` — each can remove a bound that was
protecting the wallet, or end the active session outright.

| Tool                | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `connect_wallet`    | Start a WalletConnect pairing; **replaces the active session** on approval   |
| `config_action`     | Set or view custom RPC URLs to avoid rate limits                             |
| `set_policy_rule`   | Set one rule on the local signing policy — replaces an existing rule's value |
| `clear_policy_rule` | Remove one policy rule, or the whole policy with `all: true`                 |
| `logout`            | End the WalletConnect pairing and clear the local session                    |

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
Input:  { chain?: "base" | "hyperevm" | "monad" }
Output: { authenticated, walletAddress, sessionType, authType, requiresApprovalPerTransaction, chain, fibrousStatus }
```

`requiresApprovalPerTransaction` is `true` for a `walletconnect` session — the
wallet itself prompts for every transaction, unlike `privy` and `private-key`
sessions which sign server-side.

### connect_wallet

Starts a WalletConnect pairing. Returns immediately — show the QR, then poll.

```
Input:  { }
Output: { uri, qrDataUri, pairingId }
```

`qrDataUri` is a `data:image/png;base64,...` URI so it can be rendered inside
an MCP App's sandbox without an external request.

**Not read-only.** When the user approves the pairing, this writes a new session
and discards whatever was there — a Privy login or an imported private key
included. It advertises `readOnlyHint: false`, `destructiveHint: false`,
`openWorldHint: true`, so a host that auto-approves read-only tools does not
auto-approve this one.

### get_connect_status

Polls a pairing started by connect_wallet.

```
Input:  { pairingId: string }
Output: { status: "pending" | "connected" | "failed" | "unknown", address?, error? }
```

### get_balance

Fetch all token balances for the active wallet. Only returns non-zero balances.

```
Input:  { chain?: "base" | "hyperevm" | "monad" }
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

### get_policy

Read the local signing policy without changing it. **No authentication required.**

```
Input:  {}
Output: { state: "active" | "absent" | "unreadable", rules?, path, message }
```

`absent` means no policy is set — nothing limits what this wallet will sign.
`unreadable` means a policy file exists but could not be parsed, which refuses
every transaction until it is fixed or removed; it is deliberately kept
distinct from `absent`, which permits everything.

**Example prompt:** "What's my current signing policy?" or "Is anything limiting what fibx can sign?"

### set_policy_rule

Set one rule on the local signing policy — `expiry`, `allowedChains`,
`<chain>.maxValue`, or `<chain>.allowedDestinations`. Lists are
comma-separated.

```
Input:  { rule, value }
Output: { ok, rule, value, rules }
```

**Not additive.** Setting a rule that already exists _replaces_ its value —
a lower `maxValue` can be widened back to a higher one just as easily as it
was tightened — so this advertises `destructiveHint: true`, matching
`clear_policy_rule`'s annotation for the same consequence: a cap that stops
binding. `maxValue` bounds only the native value of a transaction; an ERC-20
transfer carries `value: 0`, so use `allowedDestinations` to bound where
tokens may go.

**Example prompt:** "Cap Base transactions at 0.05 ETH" or "Only allow sending to my own address on Base"

### clear_policy_rule

Remove one rule from the local signing policy, or remove the whole policy.

```
Input:  { rule: string } | { all: true }
Output: { ok, changed, rule?, rules?, message }
```

The two call shapes are deliberately distinct and mutually exclusive — a call
naming neither `rule` nor `all`, or both, is rejected rather than guessed at.
Removing the whole policy (`{ all: true }`) leaves nothing limiting what this
wallet will sign, which is why it needs the more deliberate shape rather than
an omitted argument reading as consent.

**Example prompt:** "Remove the expiry on my policy" or "Clear my whole signing policy"

### logout

End the active session: release any WalletConnect pairing, then clear the
local session file.

```
Input:  {}
Output: { ok, message }
```

The local session is cleared even if releasing the WalletConnect pairing
fails — a teardown problem is reported, but it never leaves the caller logged
in. Authentication must be set up again afterward via `fibx auth setup` or
one of the three signing paths directly.

**Example prompt:** "Log me out" or "End my session"

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
- **A local policy bounds all three signing paths.** `fibx policy` writes a file
  on the user's machine that is evaluated before every transaction is signed —
  local key, Privy, or WalletConnect alike — so it applies on this surface,
  where a misbehaving model is the threat it exists for. It bounds the native
  value per transaction (`maxValue`), which chains may be used
  (`allowedChains`), where anything may be sent (`allowedDestinations`), and
  for how long the whole policy stands (`expiry`). A refusal comes back as
  `POLICY_BLOCKED` with the rule and the limit named. Two honest limits: it
  does not bound token amounts — an ERC-20 transfer carries `value: 0`, so only
  `allowedDestinations` constrains it — and it is a local file, so it is worth
  nothing against something that can already write to the user's disk.
- **Read-only tools need no wallet.** `get_quote`, `get_tx_status`, and
  `get_aave_markets` work with no session at all, so an agent can explore
  prices and rates before any wallet exists.

## Error Handling

All tool errors are returned as structured JSON with `isError: true`:

```json
{
	"success": false,
	"error": "Not authenticated. Run `fibx auth setup` to choose a signing path, or `fibx auth connect` / `fibx auth login <email>` / `fibx auth import` directly.",
	"code": "NOT_AUTHENTICATED"
}
```

`code` is read from the typed error anywhere in the `cause` chain, so a refusal
raised inside a transport — a `POLICY_BLOCKED` from the signing policy, say —
arrives with its own code and message rather than as `UNKNOWN_ERROR`.

EVM-specific errors (reverts, gas estimation failures) are parsed and human-readable via the `parseEvmError` utility.

## Supported Chains

| Chain    | Native Token | Fibrous Network |
| -------- | ------------ | --------------- |
| Base     | ETH          | base            |
| HyperEVM | HYPE         | hyperevm        |
| Monad    | MON          | monad           |

## Environment Variables

| Variable              | Description                                                     | Required |
| --------------------- | --------------------------------------------------------------- | -------- |
| `FIBX_API_URL`        | Custom fibx-server URL (for Privy wallet operations)            | No       |
| `FIBX_SESSION_SECRET` | Custom encryption key for session files (hex or string)         | No       |
| `FIBX_WC_PROJECT_ID`  | WalletConnect Cloud project id for `connect_wallet` — see below | No       |

A shared WalletConnect project id ships in the published bundle, so
`connect_wallet` works with no setup. It is public by necessity — a CLI has no
origin to allowlist — so its only real exposure is quota consumed by third
parties. If pairing starts failing on quota, create a free project at
[cloud.reown.com](https://cloud.reown.com) and set `FIBX_WC_PROJECT_ID` to your
own id.

If using Privy authentication, ensure [fibx-server](https://github.com/Fibrous-Finance/fibx-server) is running and accessible before starting the MCP server.

## Troubleshooting

| Problem                    | Solution                                                                       |
| -------------------------- | ------------------------------------------------------------------------------ |
| Server won't start         | Ensure Node.js >= 18 is installed and `npx fibx --version` works               |
| "Not authenticated" errors | Run `fibx auth setup` (or `auth connect` / `auth login` / `auth import`) first |
| Wallet operations fail     | Ensure `fibx-server` is running (not needed for private key imports)           |
| Rate limit errors          | Use `config_action` tool to set a custom RPC URL                               |
| Editor can't connect       | Verify the MCP config JSON syntax and restart the editor                       |
| Stale tool responses       | Config changes are auto-detected via hot-reload — no restart needed            |
