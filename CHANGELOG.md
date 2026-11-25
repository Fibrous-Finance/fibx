# Changelog

All notable changes to FibX. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/) while below 1.0, where a minor bump may change a
contract.

## [Unreleased]

### Changed

- **Node.js 20.17+, 22.13+ or 24+.** `engines` said `>=18`, but the
  dependencies bundled into FibX already required more — inquirer 13 and
  mute-stream set the floor, and commander 14, ora 9 and the MCP Apps SDK need
  20 or later. `engines`, the build target and the docs now state the real
  floor.
- The README, MCP.md, the policy tool's description and the help for
  `fibx policy set` no longer say `allowedDestinations` bounds tokens. It
  limits which addresses a transaction is sent to, and a token transfer is sent
  to the token's contract, so it cannot limit who receives the tokens.
- The docs no longer claim auto-slippage, a general preflight layer, `isError`
  on tool failures, server-side signing for imported keys, or that fibx-server
  must be running. They say which unit `estimatedGas` is in on each surface:
  a native-token fee in the CLI, gas units in the MCP tools.
- **`fibx send` and `fibx trade` wait for the receipt** (up to 180 seconds)
  before printing "confirmed", and exit 1 when the transaction reverts or has
  no receipt in time. They printed "Swap confirmed", "Transfer confirmed" and
  the like as soon as the hash came back. `swap_tokens` and `send_tokens` still
  return the hash at once.
- **An amount with a comma or a `$` is refused** on every command and tool,
  with the spelling to use. Both were stripped, so `1,5` traded 15 and
  `$100 ETH` traded 100 ETH. An amount with more decimal places than the token
  has is refused rather than rounded.
- **`--json` failures are JSON**: `{ "error": true, "code", "message" }` on
  stdout with exit code 1, in the same shape and code the MCP tools use. A
  piped run's status lines (`✔ Swap confirmed`) go to stderr, not ahead of the
  JSON. `fibx balance` without a session now exits 1.
- `swap_tokens` refuses a swap from a token to itself and bounds slippage
  itself, as `fibx trade` did; `fibx trade` now refuses the same-token swap
  too. A simulated wrap or unwrap estimates gas on both surfaces, and
  `swap_tokens` adds `estimatedGas` to that preview.

### Removed

- **Citrea.** The chain definition, its config row and its RPC are gone; it
  had not been offered since 0.10.0. `fibx config set-rpc`, `fibx config` and
  the `config_action` tool no longer accept or list it.

### Fixed

- **The encryption key file is never replaced.** When it did not hold a valid
  key — a truncated write, an editor's damage, the wrong file — FibX silently
  wrote a new one over it, and every key imported with `auth import` became
  undecryptable with the old file gone. It is now created only when absent,
  0600, and an existing one is re-tightened to 0600.
- An imported key that cannot be decrypted — a damaged or missing key file, or
  `FIBX_SESSION_SECRET` set on one run and not the next — fails with
  `DECRYPTION_FAILED`, naming the key file and how to recover, and deletes
  nothing. It used to surface as "Session JWT missing. Run `fibx auth login`".
- `fibx aave` reverted on chain but printed "Supply confirmed" (and the like):
  every Aave write and approval now reads its receipt, and a revert is an
  error. `aave_action` returns `TX_REVERTED` where it returned a `txHash`.
- `fibx aave` with a session that cannot produce a wallet — a damaged key file,
  say — reports that error instead of "No active session found".
- A reverted ERC-20 approval stops the swap at once, instead of after 30
  seconds of waiting for an allowance that will never appear.

### Security

- **FibX no longer signs whatever the route API returns.** The response is
  parsed and checked before anything is signed: the router must be the Fibrous
  router pinned for the chain (it becomes the approval's spender and the
  transaction's target), and the swap must sell the requested token and
  amount, buy the requested token, pay the requesting wallet, and set a
  minimum received no lower than the quote less the requested slippage.
  Anything else is refused with `ROUTE_REJECTED`. This proves the swap is the
  one asked for, not that the quoted price is fair.

## [0.10.2] — 2026-11-06

### Changed

- The app's header, while it opens and on failure too, shows FibX by
  Fibrous, the brand kit's endorsed lockup, in place of the Fibrous symbol
  and the word FibX. It is 20 px tall, the kit's minimum, in the kit's duo
  colours for the theme: the symbol Signal #22E6EE and the words white on
  dark, #007E85 and navy #272D3E on light. Brand teal was 2.4:1 on the light
  ground, below the kit's 3:1 floor for the symbol.
- The app takes its light or dark theme from the host — the chat app it is
  drawn in — and follows it when the host changes theme. It used to read only
  the OS setting, once, so a dark chat on a light OS drew the light app and
  the lockup's light colours. The OS setting is now only the fallback for a
  host that sends no theme.

## [0.10.1] — 2026-09-05

### Changed

- The server's instructions and the tool descriptions no longer ask the model
  to guess whether its host renders UI. `open_fibx` is to be called first for
  any wallet, balance, quote or swap question in every host — it returns the
  session, balances, policy and quote in one snapshot, and renders the app
  where the host can. `get_auth_status` no longer says "always call this
  first", which had been pulling the model away from the app; and the model is
  told not to call `get_connect_status` without a `pairingId`.

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

[Unreleased]: https://github.com/Fibrous-Finance/fibx/compare/v0.10.2...HEAD
[0.10.2]: https://github.com/Fibrous-Finance/fibx/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/Fibrous-Finance/fibx/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/Fibrous-Finance/fibx/compare/v0.8.2...v0.10.0
