# MCP Server

fibx includes a built-in [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes all DeFi operations as callable tools. AI editors like **Cursor**, **Claude Desktop**, **Antigravity**, and any MCP-compatible client can connect to fibx and execute trades, transfers, and DeFi operations through natural language.

In hosts that render [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) UI — Claude Desktop today — the server also serves **the FibX app**: one `ui://` document showing the wallet, balances, the signing policy and a swap form with the Fibrous route, opened by the `open_fibx` tool and pre-filled from the conversation. The model opens it; the user presses Simulate and Swap.

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
6. `open_fibx` is bound to the resource `ui://fibx/app.html`. A host that renders MCP Apps shows the app inline and the tool's JSON result seeds it; a host that does not simply gets the JSON — a complete snapshot of chain, session, balances, policy and quote — and the model reads that instead

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

The FibX app renders inline in Claude Desktop. After changing this file, quit
Claude Desktop fully (`Cmd+Q` on macOS) — the server process starts at launch
and is not restarted by closing a window.

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

## Available Tools (19)

### The app (2 tools)

| Tool          | Description                                                                                                                    | Auth Required |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `open_fibx`   | Open the FibX app — wallet, balances, signing policy and a swap form with the Fibrous route — pre-filled from `from/to/amount` | No            |
| `list_tokens` | List the tokens Fibrous supports on a chain, with address, decimals and USD price where known                                  | No            |

`open_fibx` advertises `readOnlyHint: true`: it executes nothing. Simulate and
Swap are buttons in the app, pressed by the user; the swap itself goes through
`swap_tokens` from inside the app, under the same signing policy as any other
caller.

### Read-Only (9 tools)

| Tool                 | Description                                                  | Auth Required |
| -------------------- | ------------------------------------------------------------ | ------------- |
| `get_quote`          | Get swap price quote, exchange rate, and route info          | No            |
| `get_auth_status`    | Check session and Fibrous API health                         | No            |
| `get_connect_status` | Poll a pairing started by connect_wallet                     | No            |
| `get_balance`        | Get the native balance and non-zero listed-token balances    | Yes           |
| `get_portfolio`      | Cross-chain portfolio with USD valuations and DeFi positions | Yes           |
| `get_tx_status`      | Check transaction receipt and status                         | No            |
| `get_aave_status`    | Get Aave V3 position health on Base                          | Yes           |
| `get_aave_markets`   | List active Aave V3 reserves with APY, totals, and LTV       | No            |
| `get_policy`         | Read the local signing policy that bounds every transaction  | No            |

### Transactional (3 tools)

These tools advertise `destructiveHint: true`; confirmation behavior depends on the MCP client and its configuration. All support `simulate=true` for a no-broadcast preview, with gas estimates returned only where available.

Amounts are plain decimals in token units with a dot (`"1.5"`). An amount with
a comma or a `$` is refused with `INVALID_AMOUNT`; both used to be stripped, so
`"1,5"` meant 15.

| Tool          | Description                                             | Simulate |
| ------------- | ------------------------------------------------------- | -------- |
| `swap_tokens` | Swap tokens via Fibrous aggregator with optimal routing | ✅       |
| `send_tokens` | Send native or ERC-20 tokens to a recipient             | ✅       |
| `aave_action` | Supply, borrow, repay, or withdraw on Aave V3 (Base)    | ✅       |

### Session & Configuration (5 tools)

These change local state rather than chain state, and all advertise
`readOnlyHint: false`. `set_policy_rule`, `clear_policy_rule`, and `logout`
also advertise `destructiveHint: true` — each can remove a bound that was
protecting the wallet, or end the active session outright. The model can call
them like any other tool: the host's confirmation prompt is the only thing
between a model and a cleared policy.

| Tool                | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `connect_wallet`    | Start a WalletConnect pairing; **replaces the active session** on approval   |
| `config_action`     | Set or view custom RPC URLs to avoid rate limits                             |
| `set_policy_rule`   | Set one rule on the local signing policy — replaces an existing rule's value |
| `clear_policy_rule` | Remove one policy rule, or the whole policy with `all: true`                 |
| `logout`            | End the WalletConnect pairing and clear the local session                    |

## Tool Details

### open_fibx

Open the FibX app. In a host that renders MCP Apps UI this is the entry point
for anything about the wallet, a balance, a quote or a swap — the model calls
it with whatever the conversation supplied, and the user works the app.

```
Input:  { chain?, from?, to?, amount?, slippage? }
Output: { chain, auth, balances, policy, terms, quote, quoteError }
```

`auth` is the session as `get_auth_status` reports it; `balances` is `null`
without a session or when the balances could not be fetched; `terms` echoes
the `from/to/amount` as passed, plus `slippage` (0.5 when not given), and
`quote` carries the Fibrous route when all three were given. A quote that
could not be fetched sets `quoteError` rather than failing the call, so the
app still opens.
The app requests one host permission, `clipboardWrite`, for the Copy link
button on the pairing screen; if the host refuses it, the button says so
instead of failing silently.

### list_tokens

List the tokens Fibrous supports on a chain. **No authentication required.**
Feeds the app's token picker; useful headlessly to resolve a symbol before
`get_quote` or `swap_tokens`.

```
Input:  { chain? }
Output: { chain, tokens: [{ symbol, name, address, decimals, price? }] }
```

### get_quote

Get a price quote for a token swap. **No authentication required** — use this to check prices before setting up a wallet.

```
Input:  { amount, from_token, to_token, chain?, slippage? }
Routed output: { input, output, rate, slippage, router, chain, quote }
Wrap/unwrap output: { input, output, rate, operation, chain }
```

`quote` carries the route in detail: `{ fromToken, toToken, inputAmount,
outputAmount, minReceived, slippage, usdIn, usdOut, priceImpact, route,
routerAddress, chain }`. `usdIn`, `usdOut` and `priceImpact` are `null` when a
token has no price — never `0` — and should be shown as unknown. `priceImpact`
is estimated from the two USD values.

Direct native/wrapped-native quotes are 1:1 conversions and therefore omit
aggregator-specific `slippage`, `router` and `quote` fields. Executing the
conversion still requires native gas.

### get_auth_status

Check whether fibx has a session and the Fibrous API is reachable. `open_fibx` already returns this as its `auth` field; call it on its own when you need the session state and nothing else, or before a transactional tool you are calling yourself.

```
Input:  { chain?: "base" | "hyperevm" | "monad" }
Output: { authenticated, walletAddress, sessionType, authType, requiresApprovalPerTransaction, chain, fibrousStatus }
```

`authenticated` means a session file is present. An expired Privy login is
only detected when a transactional tool is called (a `simulate=true` call
included), which then fails with `SESSION_EXPIRED`.

`requiresApprovalPerTransaction` is `true` for a `walletconnect` session — the
wallet itself prompts for every transaction, unlike `privy` (signed by the
Privy server) and `private-key` (signed locally with the imported key), which
never prompt.

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

Fetch the native balance (always included, even when zero) plus the non-zero
balances of the tokens Fibrous lists for the chain.

```
Input:  { chain?: "base" | "hyperevm" | "monad" }
Output: { wallet, chain, balances: { "ETH": "0.5", "USDC": "100.0", ... } }
```

### get_portfolio

Get a consolidated portfolio across all chains: holdings of the tokens Fibrous lists, valued in USD with prices from Fibrous's token list (cached for up to 24 hours; a token with no price counts as $0), plus DeFi positions. A chain that fails to load is left out.

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
Preview output:   { success, mode, amountIn, amountOut?, tokenIn, tokenOut, router?, chain, operation?, estimatedGas?, requiresApproval? }
```

`estimatedGas` is gas units (a decimal string), not a fee. An ERC-20 preview
with insufficient allowance reports
`requiresApproval: true` without broadcasting an approval; in that case it
does not claim a swap gas estimate. A wrap/unwrap preview returns `operation:
"wrap"` or `"unwrap"` and an `estimatedGas`, with no `amountOut` or `router`; a
failed estimate is reported as `Simulation failed: …`. A swap from a token to
itself is refused. Before a swap is signed, the route Fibrous returns is
checked: pinned router, and the requested tokens, amount, destination and a
minimum received no lower than the quote less the slippage; a response that
fails is refused with `ROUTE_REJECTED`. The tool returns the hash as soon as the
swap is sent — poll `get_tx_status` for the outcome.

**Example prompt:** "Swap 0.1 ETH to USDC on Base" or "Simulate swapping 100 USDC to DAI"

### send_tokens

Transfer native or ERC-20 tokens, with an optional no-broadcast preview.

```
Input:  { amount, recipient, token?, chain?, simulate? }
Execution output: { txHash, amount, token, recipient, chain, explorer? }
Preview output:   { success, mode, amount, token, recipient, chain, estimatedGas? }
```

`estimatedGas` is gas units (a decimal string), not a fee. Native-token
previews include it. ERC-20 previews validate the contract call but currently
do not return a gas estimate.

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

List the active Aave V3 reserves on Base with supply and borrow APY, total supplied and borrowed (in token units, not USD; borrowed is variable debt), LTV, and whether the reserve is frozen. Inactive reserves are left out. No wallet required.

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

`txHash` is absent, and `status` present, only when no transaction was needed:
`status` is then the sentence "No transaction sent — debt was already
cleared", not a transaction status.

`aave_action` waits for each transaction's receipt, as it always has, and now
reads it: a reverted transaction comes back as `TX_REVERTED` with the hash in
`details`, where it used to be returned as an ordinary `txHash`.

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
Output: { state: "active" | "absent" | "unreadable", rules?, path, message? }
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
transfer carries `value: 0`, so the cap never sees a token amount.

`allowedDestinations` limits which addresses a transaction may be sent to. The
policy sees a transaction's `to` address, and a token transfer's `to` is the
token's contract, not the recipient — so this rule cannot limit who receives
tokens. A token whose contract is on the list can be sent to anyone; a token
whose contract is not on it cannot be moved at all. Swaps, approvals and Aave
calls are sent to a router, pool or token contract, which must be listed too,
or they are refused.

**Example prompt:** "Cap Base transactions at 0.05 ETH" or "On Base, only allow transactions to my own address and the Fibrous router" (that list refuses every token transfer and approval, since neither goes to a listed address)

### clear_policy_rule

Remove one rule from the local signing policy, or remove the whole policy.

```
Input:  { rule: string } | { all: true }
Output: { ok, changed, rule?, rules?, message? }
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
  where a misbehaving model is the threat it exists for — as long as the host
  asks before running `set_policy_rule` or `clear_policy_rule`, because a model
  can call those too. It bounds the native
  value per transaction (`maxValue`), which chains may be used
  (`allowedChains`), which addresses a transaction may be sent to
  (`allowedDestinations`), and for how long the whole policy stands
  (`expiry`). A refusal comes back as `POLICY_BLOCKED` with the rule and the
  limit named. Three honest limits: it does not bound token amounts — an
  ERC-20 transfer carries `value: 0`; it does not bound who receives tokens —
  a token transfer is sent to the token's contract, so `allowedDestinations`
  sees the contract, not the recipient; and it is a local file, so it is worth
  nothing against something that can already write to the user's disk.
- **Read-only tools need no wallet.** `get_quote`, `get_tx_status`,
  `get_aave_markets`, `list_tokens` and `open_fibx` work with no session at
  all, so an agent can explore prices and rates before any wallet exists.
- **The app executes nothing on its own.** `open_fibx` renders; a swap leaves
  the app only when the user presses Swap, after Simulate, and it still passes
  through the local signing policy. The model never gets to press the button.

## Error Handling

Tool errors come back as a normal tool result — `isError` is not set — whose
JSON body is:

```json
{
	"success": false,
	"error": "Not authenticated. Run `fibx auth setup` to choose a signing path, or `fibx auth connect` / `fibx auth login <email>` / `fibx auth import` directly.",
	"code": "NOT_AUTHENTICATED",
	"rawMessage": "Not authenticated. Run `fibx auth setup` to choose a signing path, or `fibx auth connect` / `fibx auth login <email>` / `fibx auth import` directly."
}
```

`details` is added when there are any. Check `success === false`. The MCP SDK
sets `isError: true` only for failures it raises itself, such as invalid
input.

That example is what a transactional tool returns without a session. The
read tools that need one (`get_balance`, `get_portfolio`, `get_aave_status`)
instead return "No active session. …" with code `UNKNOWN_ERROR`.

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

| Variable              | Description                                                                                            | Required |
| --------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| `FIBX_API_URL`        | fibx-server URL for Privy (`auth login`); a hosted instance is used when unset                         | No       |
| `FIBX_SESSION_SECRET` | Secret used to encrypt the imported private key in the session file (64 hex characters, or any string) | No       |
| `FIBX_WC_PROJECT_ID`  | WalletConnect Cloud project id for `connect_wallet` — see below                                        | No       |

A shared WalletConnect project id ships in the published bundle, so
`connect_wallet` works with no setup. It is public by necessity — a CLI has no
origin to allowlist — so its only real exposure is quota consumed by third
parties. If pairing starts failing on quota, create a free project at
[cloud.reown.com](https://cloud.reown.com) and set `FIBX_WC_PROJECT_ID` to your
own id.

fibx-server is only used for Privy (`auth login`); FibX uses a hosted
instance by default, and `FIBX_API_URL` points it at your own.
`connect_wallet` and imported keys do not use it.

## Troubleshooting

| Problem                    | Solution                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| Server won't start         | Ensure Node.js 20.17+, 22.13+ or 24+ is installed and `npx fibx --version` works            |
| "Not authenticated" errors | Run `fibx auth setup` (or `auth connect` / `auth login` / `auth import`) first              |
| Wallet operations fail     | For a Privy wallet with `FIBX_API_URL` set, check that fibx-server is reachable at that URL |
| Rate limit errors          | Use `config_action` tool to set a custom RPC URL                                            |
| Editor can't connect       | Verify the MCP config JSON syntax and restart the editor                                    |
| Stale tool responses       | Config changes are auto-detected via hot-reload — no restart needed                         |
| The app does not appear    | The host does not render MCP Apps; the model gets `open_fibx`'s JSON instead                |
| The app is out of date     | Quit the host fully (`Cmd+Q`) — the server process only starts at app launch                |
