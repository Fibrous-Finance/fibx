# Changelog

All notable changes to FibX. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/) while below 1.0, where a minor bump may change a
contract.

## [0.10.0] — 2026-09-05

### Added

- **The FibX app as MCP Apps UI.** One tool, `open_fibx`, bound to one
  `ui://fibx/app.html` document: wallet, balances, signing policy and a swap
  form with the Fibrous route, rendered inline in hosts that support MCP Apps
  (Claude Desktop) and pre-filled from the conversation. The user presses
  Simulate and Swap; the model never does. Text-only hosts get the same call's
  JSON snapshot. Built with Preact and Vite, inlined into the single `dist`
  file — still no runtime dependencies.
- `list_tokens` — the tokens Fibrous supports on a chain, with address,
  decimals and USD price.
- **Your own wallet over WalletConnect.** `fibx auth connect` pairs a wallet
  by QR; every transaction is approved on the phone. Over MCP, `connect_wallet`
  and `get_connect_status` do the same, and `logout` ends the pairing.
- **A local signing policy.** `fibx policy show|set|clear` writes a file the
  user owns — `maxValue` per chain, `allowedChains`, `allowedDestinations`,
  `expiry` — enforced before every signature on all three signing paths. Over
  MCP: `get_policy`, `set_policy_rule`, `clear_policy_rule`. A refusal is
  `POLICY_BLOCKED` with the rule named.
- `fibx auth setup` presents the three signing paths as peers instead of
  steering everyone to Privy.
- `get_quote` returns the route Fibrous already computed, with protocol ids
  resolved to names.
- A dev host for the widget (`pnpm dev:ui`), with fixtures for every state
  and a guarded bridge to the real server.

### Changed

- The MCP server's instructions tell the model the app exists and is the entry
  point in a UI-rendering host; `get_auth_status` is no longer demanded before
  every read.
- Failures inside the app are sentences, never an RPC dump: a shortfall is
  refused before any call, an `eth_estimateGas` failure reads "The simulation
  failed", and a broadcast whose receipt never arrives is "Unresolved", not
  confirmed.
- The slippage bound is defined once (0.01–50 %) and shared by the CLI, the
  MCP tools and the app.
- Citrea is withdrawn from the offering (delisted by Fibrous on 2026-08-10);
  the chain rows remain, the lookup refuses it.

### Fixed

- `get_portfolio` no longer fails on the withdrawn chain.
- `balance` no longer lists the native coin twice.
- A cancelled transaction prints one line, not a stack.
- The WalletConnect SDK stays off every command's startup path.
- `set_policy_rule` advertises the right hint; clearing everything requires
  `all: true`; clearing a rule that is not set is a no-op, not an error.
- Every path that replaces a session first ends the WalletConnect pairing it
  is replacing.

### Security

- The dev host's bridge binds 127.0.0.1 only, checks the exact origin, and
  relays an allowlist of tools — it can reach the real wallet, and says so.
- The app never gets a raw key, a session secret or the policy file: it sees
  what `open_fibx` returns and calls the same tools any client can.

## [0.9.0] and earlier

See the [git history](https://github.com/Fibrous-Finance/fibx/commits/main)
and the [npm versions](https://www.npmjs.com/package/fibx?activeTab=versions).

[0.10.0]: https://github.com/Fibrous-Finance/fibx/compare/v0.8.2...v0.10.0
