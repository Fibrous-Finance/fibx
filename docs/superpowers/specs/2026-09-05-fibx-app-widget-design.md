# One app, not two cards: the FibX widget

**Date:** 2026-09-05
**Status:** approved in conversation, spec under review
**Supersedes:** the two-surface design in
`2026-09-02-panel-buttons-and-swap-card-design.md` (Phase A/B). That work is
kept — its route data, its error handling on the swap path, its bundle
measurements — but its _shape_ is replaced.

## What the first real use taught

The wallet panel and the swap card shipped, were reviewed, and were tried by
hand. Three things came back, and only the first is a bug.

1. **Simulate showed a raw RPC dump.** The wallet held 0.0002 ETH; the user
   asked to swap 0.0005. `eth_estimateGas` reverted, and the card printed the
   whole JSON-RPC request body in red. The card was right to stop and wrong
   about everything else: it should have said _insufficient balance_ before
   Simulate was ever pressed.
2. **The buttons "did not work."** Copy and _Open in your wallet_ both vanished
   on click, because the host refused the clipboard and the `wc:` scheme, and
   the panel's rule was that a control which cannot work must not be shown.
   The rule was right and the outcome was wrong: a control that disappears
   without a word reads as broken, not honest.
3. **It did not feel like an app.** This is the one that matters. MCP Apps
   render one widget per tool call, and the design bound two tools to two
   surfaces. Asking about the wallet produced one box; asking for a quote
   produced another; nothing showed the whole. The user's expectation was
   never two cards. It was **app.fibrous.finance, small, inside the chat.**

The 2026-09-02 spec named "a swap form inside the panel" as Phase C and
deferred it. That was a mistake in framing: Phase C was not an addition to the
product, it was the product. This spec is Phase C, done properly, and it
absorbs A and B.

## The shape

**One tool, one document, one application.**

```
open_fibx({ chain?, from?, to?, amount?, slippage? })
   │  read-only; the ONLY tool bound to a ui:// resource
   ▼
{ auth, balances?, policy, quote?, chain }      one snapshot
   │
   ▼
ui://fibx/app.html                              one document, one App
```

`open_fibx` composes handlers that already exist — `get_auth_status`,
`get_balance` (when authenticated), `get_policy`, and `get_quote` (when
`from`/`to`/`amount` are given). It adds no business logic; it adds a roof.
Called bare, it opens the app. Called with parameters, it opens the app
**pre-filled** — that is the whole of the "chat pre-fills the widget"
behaviour, and it costs nothing beyond the parameters.

The tool's description carries the steering: _"Call this for anything about
the wallet, balances, a quote, or a swap. The user sees the app and acts from
it."_ `get_quote`'s description gains one line: _"In a host that renders UI,
prefer `open_fibx`, which shows the route and lets the user swap from it."_

**Everything else stays headless.** `get_quote`, `get_auth_status`,
`get_balance`, `get_policy`, `swap_tokens` and the rest lose their `_meta.ui`
bindings and keep working exactly as they do for the Telegram bot and for CLI
agents. `ui://fibx/wallet-panel.html` and `ui://fibx/swap-card.html` are
removed; their code is reorganised into the app's sections, not thrown away.

One new headless tool: `list_tokens({ chain })` →
`[{ symbol, name, address, decimals, price? }]`, exposing the existing
`getTokens(chain)` service. Only the widget's picker calls it.

### Why one tool rather than binding the widget to every reader

Binding `get_auth_status`, `get_quote`, `get_balance` and `get_policy` each to
the same document would need no new tool — and would produce three full
applications in the chat when the model calls three tools in a turn, each
seeded with a fragment and fetching the rest. That is the "everything comes
separately" complaint made worse. One tool means one turn produces one app,
seeded with one consistent snapshot.

### The limit that stays

MCP Apps produce **a new widget instance per tool call**. Two chat messages
that each cause `open_fibx` produce two widgets. This cannot be changed from
the server side. What this design guarantees is that every instance is the
whole application, and that changing tokens, amounts or chain **inside** the
widget never produces another one — those calls go through `callServerTool`
and return to the same instance.

## Layout

The layout is `fibrous-interface/components/swap/swap.tsx`, reduced:
`SourceTokenInput → direction arrow → DestinationTokenInput → PriceInfo →
footer`, with the token picker layered over the body. Wallet lives in the
header as it does on app.fibrous.finance. Policy is FibX-specific and lives at
the bottom, collapsed.

```
┌─────────────────────────────────────────────┐
│ FibX        [Base ▾]        [0x0363…3d44 ▾] │  header: chain, wallet
├─────────────────────────────────────────────┤
│ You pay                                      │
│ [ 0.001        ]              [ ETH  ▾ ]     │  source
│   $2.45                        bal 0.0002    │
│                    ⇅                         │  direction (clickable)
│ You receive                                  │
│ [ 2.453625     ]              [ USDC ▾ ]     │  destination
│   $2.45                                      │
├─────────────────────────────────────────────┤
│ 1 ETH ≈ 2453.63 USDC      impact 0.02%       │  price info
│ Route: PancakeSwap V3 · BaseSwap V3 · …      │
│ Min received ≈ 2.441357  slippage [0.5]%     │
├─────────────────────────────────────────────┤
│ [        Simulate        ] [     Swap     ]  │  footer
├─────────────────────────────────────────────┤
│ ▸ Signing policy — none set                  │  collapsed; FibX-specific
└─────────────────────────────────────────────┘
```

- **Chain selector**: Base / HyperEVM / Monad, the three chains fibx offers.
  Changing it re-fetches tokens and re-quotes. No adding chains.
- **Wallet button**: "Connect" when there is no session; pressing it replaces
  the body with the pairing view (QR, `wc:` URI, explanation) and returns to
  the form on connect. When connected it shows the short address; pressing it
  offers _End session_. The three signing paths are described here exactly as
  the existing panel describes them.
- **Token buttons**: pressing one layers the picker over the body — a search
  input and the chain's list from `list_tokens`, with six popular tokens
  pinned at the top. **No favourites, no categories.** The picker is a mini
  version of `components/select-token`, not a port of it.
- **Amount**: the source amount is typed; the destination amount is the
  quote's output and is read-only. Below the source amount, the wallet's
  balance for that token when connected.
- **Direction arrow**: swaps source and destination, re-quotes.
- **Policy**: the existing `PolicyCard` logic — three states, rule add,
  rule remove, two-step whole-policy wipe, the `maxValue` caveat — moves here
  unchanged in behaviour, collapsed by default, expanded when a policy
  refusal names it.

Visual language: the Fibrous tokens already in `ui/src/tokens.css`, the card
rhythm from the 2026-09-02 work. Brand teal on the one primary action per
state; ghost for everything else; `danger` on the button that performs a
wipe.

## Data flow

Every call the widget makes goes through `callServerTool` and returns to the
same widget instance. None of them renders a new widget.

| When                           | Call                                                | Trigger                                       |
| ------------------------------ | --------------------------------------------------- | --------------------------------------------- |
| amount, token or chain changed | `get_quote`                                         | automatic, 400 ms debounce                    |
| token button pressed           | `list_tokens`                                       | click; cached per chain for the widget's life |
| Connect                        | `connect_wallet`, then `get_connect_status` polling | click                                         |
| Simulate, Swap                 | `swap_tokens`                                       | **click only**                                |
| after a broadcast              | `get_tx_status` polling                             | automatic, only once a hash exists            |
| policy rule added or removed   | `set_policy_rule`, `clear_policy_rule`              | click                                         |

**No tool that moves money is ever called without a click.** The only
automatic call is `get_quote`, which is read-only — and which app.fibrous.finance
also fires as the user types.

### One state machine for the whole form

```
editing ──(quote arrived)──▶ quoted ──(Simulate)──▶ simulating ──▶ simulated
   ▲                           │                                       │
   │  any field changed;       │                                 (Swap)│
   └── simulate is void ───────┘                                       ▼
                                                  swapping ──▶ broadcast
                                                                      │
                                           ┌──────────────────────────┤
                                           ▼            ▼             ▼
                                       confirmed    reverted       unknown
```

The guards from the 2026-09-02 swap card carry over exactly:

- **Swap unlocks only after a successful Simulate for the current terms.** Any
  change to amount, token, chain or slippage returns the machine to `editing`
  and locks Swap.
- **`unknown` is terminal and locks the whole form.** A hash was broadcast and
  never resolved within the polling window; the hash and the explorer link
  stay visible; Swap, Simulate, refresh and every input are disabled. There
  is no safe retry for a transaction that may be in flight.
- **A throw while polling `get_tx_status` means "not mined yet."** viem's
  `getTransactionReceipt` throws for a pending transaction. Only a returned
  `status` of `confirmed` or `reverted` is terminal.
- `failed` after a swap attempt says that an approval may already have been
  sent — `handleSwapTokens` broadcasts the ERC-20 `approve` before the swap.

The machine is a **pure module** (`ui/src/machine.ts`): a state type, an
event type, and `transition(state, event)`. The previous card's guard logic
lived inline in JSX and could only be verified by hand; the final review named
that as the seam to extract. This design extracts it.

### The picker

`list_tokens` is called on first open per chain and cached in the widget.
Search filters by symbol and name, case-insensitively, on the client — a few
hundred tokens is not a search problem. Six popular tokens per chain are
pinned at the top; the list is a hand-written constant, not a tool. Selecting a
token closes the picker and re-quotes.

### Telling the model

`updateModelContext` is called at every state the model could otherwise get
wrong: connected (with address), disconnected, quote updated (tokens and
amounts), broadcast (**pending, never "done"**), confirmed, reverted, unknown.
The 2026-09-02 final review's Critical was a card that told the model a swap
succeeded the moment a hash existed; this design's rule is that the broadcast
sentence says _awaiting confirmation_ and only a terminal state says what
happened.

## Errors in the user's language

A raw message never reaches the user. `explainError(raw, context)` maps known
signatures to a sentence, a severity, and — where one exists — an action:

| Signal                                                            | The user sees                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `insufficient funds`, or estimateGas revert with amount > balance | **Insufficient balance.** You have 0.0002 ETH; this needs 0.0005.          |
| policy refusal (`POLICY_*` code)                                  | **Blocked by your signing policy:** `base.maxValue = 0.05`. Edit it below. |
| `User rejected` from WalletConnect                                | **Rejected in your wallet.** Nothing was sent.                             |
| slippage, `INSUFFICIENT_OUTPUT_AMOUNT`                            | **The price moved.** Refresh the quote or raise slippage.                  |
| token could not be resolved                                       | **"XYZ" is not on this chain.** Pick from the list.                        |
| anything else                                                     | the first line, plus a _details_ disclosure holding the raw text           |

**Balance is checked before Simulate is possible.** When the amount exceeds
the wallet's balance for the source token, the form shows the shortfall in red
and Simulate is disabled. The raw `eth_estimateGas` dump the user saw cannot
occur, because the call that produced it is never made.

**A control that cannot work explains itself in place; it does not vanish.**
Copy tries the async clipboard, then `document.execCommand("copy")` on the
selected URI — the legacy path usually survives a sandbox that blocks the
modern one — and if both fail the button becomes a one-line note: _clipboard
unavailable; select the URI above._ _Open in your wallet_ behaves the same
way on a refused `wc:` scheme.

## The dev host

Nobody could see the widget without Claude Desktop, and so nobody saw the
vanishing buttons or the RPC dump until the user did. That is a tooling gap,
and this design closes it as a first-class component rather than an
afterthought.

`ui/dev-host/` — excluded from the build and the published bundle:

```
ui/dev-host/index.html      a page using ext-apps' AppBridge (host side)
        │  <iframe src="../dist/index.html">
        │  ui/initialize → toolresult (fixture or live)
        ▼
  callServerTool ──▶ fixtures/*.json      default: deterministic
                └──▶ live fibx via bridge  optional
```

- **Fixture mode** is the default: an `open_fibx` snapshot, a `list_tokens`
  list, a quote, a simulate with `requiresApproval`, a broadcast followed by
  `confirmed`, one followed by `reverted`, and an insufficient-funds error.
  Every state of the widget is one click away, with no Claude Desktop and no
  wallet.
- **Live mode**: a small Node bridge (`ui/dev-host/bridge.ts`) spawns
  `fibx mcp-start` over stdio and relays JSON-RPC from the browser. Real
  quotes, real pairing. Also excluded from the build.
- **Capability simulation**: the host page can grant or refuse `clipboardWrite`
  and accept or refuse a `wc:` URL in `openLink`, reproducing what Claude
  Desktop does. The vanishing-button bug would have been visible here.

`pnpm dev:ui` opens it. The same page is what the assistant opens in its own
browser tool to see what the user sees, before saying anything is fixed.

## Testing

Three layers.

1. **Pure logic** — vitest, as today: `transition()` over every event in every
   state, `explainError` over every known signature, the balance check, the
   slippage bound, token search filtering.
2. **Component** — vitest with `happy-dom`, a **new devDependency**: Swap's
   lock and unlock, a control turning into its explanation, the picker
   filtering and selecting, the `unknown` state disabling everything.
   `dependencies` stays absent; `happy-dom` sits beside vitest in
   `devDependencies`. A previous round asserted the zero-dependency rule
   forbade this; it does not, and the record was corrected.
3. **Dev host** — by hand, and optionally driven: every fixture state,
   inspected.

Server side, `open_fibx` and `list_tokens` are tested the way the existing
handlers are — modules mocked, **never the real config directory**
(`~/Library/Preferences/fibx-nodejs`, which `env-paths` will not let an
environment variable redirect on macOS).

## Bundle

One document, one 400 KB guard, measured in **bytes** (the 2026-09-02 final
review corrected the unit). The document is at 361,521 bytes. The picker, the
unified form, the policy section and the error layer are estimated at +25 KB,
landing near 386 KB. That is tight. The plan measures after the first task
that adds UI and after every task thereafter; if the guard is crossed, the
guard is not raised — the options are a spike on tree-shaking the unused
schema surface of `App`, or a smaller picker.

## Out of scope

- Aave, transfers, portfolio — the widget is a swap surface; those stay
  headless.
- Token logos (`image_url` is in the token list, but rendering it needs
  `_meta.ui.csp.resourceDomains`).
- Favourites, categories, custom recipient, batch swaps.
- Adding chains. Switching among the three that exist, only.
- Any change to the three signing paths or to `swap_tokens`' annotations.
- A persistent panel across turns. The platform does not offer one.

## Risks

**The model may call `get_quote` directly and answer in prose.** Tool
descriptions steer; they do not compel. This is observable only in a real
host, so the manual verification step asks for it specifically. If it proves
common, the follow-up is to check the client's declared UI capability at
`initialize` and adjust descriptions per host — a separate spike.

**Claude Desktop may not honour `_meta.ui.permissions` at all.** Copy was
refused despite the declaration. The `execCommand` fallback exists for this;
the dev host's capability simulation makes both paths testable.

**The bundle guard.** Named above. The first UI task in the plan measures
before the picker is written, and the picker is the component to shrink if
the number is wrong.

**One new devDependency.** `happy-dom` is the first DOM test environment in
`ui/`. It is permitted and overdue; it is still a new package, and the plan
pins its version.
