# Panel buttons that work, and a swap card worth the name

**Date:** 2026-09-02
**Status:** approved, not yet planned
**Scope:** Phase A (the panel's buttons and visual language) and Phase B (a
structured quote and a swap card in chat). Phase C — a swap form inside the
panel — is named at the end and deliberately excluded.

## Why now

The wallet panel shipped and was verified by hand. Two things came back from
that first real use:

1. **The buttons did not work.** Copy link did nothing. The wallet shortcuts
   did nothing useful.
2. **The panel says nothing about what FibX is.** FibX aggregates. The panel
   shows a wallet, balances and a policy — none of which is the product's
   argument.

Both have causes worth writing down, because neither is a coding slip.

## Three findings

### Copy link was silent because we never asked for the clipboard

MCP Apps gate browser capabilities behind a declared permission.
`McpUiResourcePermissions` (in `@modelcontextprotocol/ext-apps`) has exactly
four members — `camera`, `microphone`, `geolocation`, `clipboardWrite` — and a
resource declares what it needs through `_meta.ui.permissions`. We declared
none. The host therefore rendered the iframe without `clipboard-write` in its
`allow` attribute, `navigator.clipboard.writeText` rejected, and our `catch`
swallowed it with a comment about the textarea being selectable. Nothing
reached the user.

The spec's own words are the design rule here: _"Apps SHOULD NOT assume
permissions are granted; use JS feature detection as fallback."_ Declaring the
permission is necessary and not sufficient — a host may still refuse.

### The wallet shortcuts open a browser, not a wallet

`openLink` is documented as _"Request to open an external URL in the host's
default browser."_ It is not "open in app". The three shortcuts hand it
`https://metamask.app.link/wc?uri=…` and its siblings, which are mobile
universal links. On a desktop host that URL resolves to a web page telling the
reader to open their app — technically a success, practically a dead end, and
`openLink` returns no error because nothing failed.

**There is no platform signal to branch on.** `McpUiHostContext` carries
`theme`, `styles`, `displayMode`, `availableDisplayModes` and
`containerDimensions` — and nothing that says mobile or desktop. A design that
shows the shortcuts only on mobile cannot be built from what the host tells us.

### The aggregator's value is fetched and then discarded

This is the one that matters. `getRouteAndCallData` (`src/services/fibrous/route.ts`)
returns, on every quote:

| In the response                      | What it is                                                           |
| ------------------------------------ | -------------------------------------------------------------------- |
| `route.inputToken` / `outputToken`   | symbol, decimals **and USD price**                                   |
| `route.inputAmount` / `outputAmount` | base units, exact                                                    |
| `calldata.route.min_received`        | the slippage floor, already computed                                 |
| `calldata.swap_parameters[]`         | **the actual hops** — `protocol_id`, `pool_address`, `rate` per swap |
| `router_address`                     | the router the swap will go through                                  |

`get_quote` reduces all of that to four prose strings: `input: "0.1 ETH"`,
`output: "~0.42 USDC"`, `rate: "1 ETH ≈ 4.2 USDC"`, `slippage: "0.5%"`. A card
cannot draw a route from a sentence. The data an aggregator exists to show is
already on the wire and thrown away before anything can render it.

Protocol ids resolve to names. Fibrous serves them at
`GET {FIBROUS_GRAPH_URL}/{network}/protocols` — the same endpoint
`fibrous-interface` calls through `useNormalizedProtocolNames` — returning
`{ protocol, display_name, amm_name, image_url }`. `FIBROUS_GRAPH_URL` is
already in `src/lib/config.ts`.

## Phase A — buttons that tell the truth, in Fibrous's own language

### Clipboard

Declare `_meta.ui.permissions = { clipboardWrite: {} }` on the wallet panel
resource. Then feature-detect rather than assume:

- Copy succeeds → the button says **Copied** for a beat, then returns.
- Copy fails or `navigator.clipboard` is unavailable → do not show a Copy
  button at all. The `wc:` URI stays in its selectable textarea, which is the
  fallback that always works.

A button that silently does nothing is worse than no button. That is the rule
this phase is built on.

### Wallet shortcuts

Since the host reports no platform, and `openLink` reports success for a link
that leads nowhere useful, the three brand shortcuts are **removed**. The QR
plus a working copy is the honest desktop path, and it is the path that
actually completed a pairing during manual verification.

The plan should probe one thing before the removal is final: whether `openLink`
accepts a bare `wc:` URI. Desktop wallets register `wc:` as a protocol handler,
so if the host passes it through, a single **Open in your wallet** button
replaces the three brand buttons and works on both platforms. If the host
rejects non-`http(s)` schemes, the removal stands. This is a five-minute probe
and it decides one button.

### Visual language

Classic Fibrous, from `fibrous-interface/styles/globals.css`: brand teal
`17 178 186`, dark ground `27 31 44`, surface `39 45 62`, Urbanist for headings
and Rubik for numbers. The panel already leans this way; this phase aligns the
card rhythm, spacing and button hierarchy with `components/confirm-swap`, whose
modal orders its sections _details → recipient → min received → action_.

Tokens stay hand-lifted into `ui/src/tokens.css`. The 377 KB design-system
bundle is not importable — every byte of the panel is inlined into the server
bundle and refetched on each render.

## Phase B — a structured quote, and a swap card in chat

### `get_quote` gains data beside its prose

The existing string fields stay. The model reads them and they are good copy.
Alongside them, the tool returns what a card needs:

```
outputAmount   exact, in display units
minReceived    from calldata.route.min_received
priceImpact    computed from the two USD prices already in the response
usdIn, usdOut  the same two prices applied to the amounts
route          [{ protocol: number, displayName?: string, pool: string }]
routerAddress
```

`displayName` comes from a new `getProtocols(chain)` in
`src/services/fibrous/` hitting `{FIBROUS_GRAPH_URL}/{network}/protocols`,
cached the way `getTokens` already is. When that call fails the card still
renders — hops show as pool addresses and the swap is unaffected. **A quote
must never fail because a cosmetic lookup failed.**

Price impact is a computation, not a field Fibrous returns. State it as derived
in the tool's description so nobody later mistakes it for the router's own
number.

### The card

A second `ui://` resource, bound to `get_quote` — which is `readOnlyHint: true`,
so the card appearing changes nothing. It renders:

- **You Pay / You Receive**, amounts with their USD value beneath
- the rate, and price impact, coloured when it crosses a threshold worth
  worrying about
- **the route** — the hops, by name where the protocols endpoint answered
- **min received**, with the slippage that produced it, editable
- **Simulate** and **Swap**

Editing slippage re-calls `get_quote`. **Simulate** calls
`swap_tokens({ simulate: true })`, which returns without broadcasting and
reports `requiresApproval` when the router needs an allowance first — a real
state the card should show, because it means the swap is two transactions and
two phone approvals, not one.

**Swap** calls `swap_tokens`, which is `readOnlyHint: false,
destructiveHint: true`. The host prompts. The wallet prompts. The local signing
policy is consulted before either. Three gates, none of them ours to weaken.

After a broadcast the card follows the hash with `get_tx_status` until it
confirms or reverts, and shows the explorer link the handler already returns.

### The model must learn what the card did

MCP Apps do not push UI state back to the model. During manual verification the
model's prose said "not connected" under a panel that showed connected, because
it still believed the last tool result it had seen. The card calls
`app.updateModelContext` after a swap broadcasts, so the next turn knows a
transaction exists. The wallet panel gets the same treatment after connect and
logout.

## Out of scope

- **Phase C — a swap form inside the wallet panel.** It needs token selection,
  which needs a `list_tokens` tool that does not exist: `getTokens(chain)` is a
  service function the MCP surface never exposed. Deferred deliberately, and
  the card built here is meant to be the component that form reuses.
- Protocol logos. `image_url` is in the protocols response, but showing it
  needs `_meta.ui.csp.resourceDomains`, and names alone carry the argument.
- Any change to how the three signing paths work.
- Component tests for the panel — still the standing follow-up, still needing a
  DOM environment.

## Risks

**A second `ui://` resource doubles the inlined weight.** The panel is 352 KB
against a 400 KB guard, almost all of it the SDK schema layer that `App` pulls
in. Two resources sharing one bundle is fine; two bundles each carrying their
own copy of `App` is not. The plan must build both from one Vite entry and
verify the total against the guard before the second card is written, not
after.

**`priceImpact` is derived from prices Fibrous returns for the two tokens.**
Those are spot prices, not the pool's marginal price. On a thin pool the
computed impact and the realised one will differ. Label it as an estimate.

**Removing the wallet shortcuts is visible.** They render today. If the `wc:`
probe succeeds they are replaced rather than removed, which is the better
outcome; if it fails, the change should be described plainly in the commit
rather than dressed up.
