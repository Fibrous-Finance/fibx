# MCP Apps: the wallet panel

**Date:** 2026-08-30
**Status:** approved, not yet planned

## Goal

Give FibX an interactive wallet panel that renders inside MCP hosts — Claude
Desktop first — covering the whole connection lifecycle: pairing a wallet,
seeing what is signing, and reading and editing the signing policy that bounds
it.

This is the surface WalletConnect was added for. The QR that ships today is an
ASCII drawing in a terminal; a panel is what it was always meant to be.

## Why this is possible without going remote

MCP Apps is transport-agnostic. A server declares a `ui://` resource; the host
fetches it and renders it in a sandboxed iframe. Nothing in that requires the
server to be reachable over the network, and Claude Desktop supports the
extension for locally-configured stdio servers.

This matters more than it sounds. The alternative — a hosted MCP server — would
have moved the WalletConnect session onto our infrastructure and, with it, the
signing policy. The policy's whole argument is that it is the user's file on
the user's machine. A local MCP App keeps that intact and adds a UI on top.

## What is being built

One panel, bound to one read-only tool, rendering two states.

**Disconnected.** A QR code, the `wc:` URI as copyable text, shortcuts that
hand the URI straight to MetaMask / Rabby / Rainbow for same-device use, and a
live status line: waiting → connected → expired, with a retry.

**Connected.** The wallet address and which of the three signing paths it is
(WalletConnect, Privy, imported key), the active chain, a balance summary, the
active policy rules with per-rule edit and remove, and a way to end the session.

## Architecture

### The UI resource

A single self-contained HTML document registered under a `ui://` URI via
`registerAppResource` from `@modelcontextprotocol/ext-apps/server`. The host's
CSP is deny-by-default, so every byte of script and style is inlined.

Built with Preact and a token subset extracted from `fibrous-interface`'s
`ds-bundle/_ds_bundle.css`. Preact rather than React because the document is
inlined into the server bundle and refetched by the host on each render, so its
size is paid repeatedly. The 8.2 MB `_ds_bundle.js` is not usable here at all;
only the token vocabulary travels — `bg-bg-primary`, `text-text-primary`,
`bg-brand-primary`, `font-rubik`, `font-display` — so the panel looks like
Fibrous without carrying it.

`vite-plugin-singlefile` produces the HTML; tsup inlines it into the server
bundle as a string. The zero-runtime-dependency constraint is untouched: the
HTML is a build artifact, not a dependency.

### Which tool carries the UI

`get_auth_status`, via `_meta.ui.resourceUri`. It is read-only, so opening the
panel starts nothing.

This is deliberate and it is the one binding that must not change.
`connect_wallet` opens a real WalletConnect pairing as a side effect — binding
the panel to it would mean that merely rendering the panel tears down whatever
session exists and starts a new one. The panel calls `connect_wallet` through
`app.callServerTool()` when the user presses the button, which is where that
side effect belongs.

Verified against the code: `get_auth_status` is already annotated
`readOnlyHint: true`, and already returns everything the connected state needs
— `authenticated`, `walletAddress`, `sessionType`, `chain` and
`requiresApprovalPerTransaction`. It takes an optional `chain` and performs one
Fibrous health check, so it is read-only but not instant; the panel should
render its frame before the first result lands rather than waiting on it.

### Tools the panel needs

Four do not exist yet. The MCP surface currently has no notion of the signing
policy at all — `config_action` covers RPC URLs only — so an agent working
through MCP is blocked by a policy it cannot read. These tools close that gap
and would be worth adding even if the panel were abandoned.

| Tool                | Shape                                                            | `readOnlyHint` |
| ------------------- | ---------------------------------------------------------------- | -------------- |
| `get_policy`        | no arguments; returns the active rules, or absent, or unreadable | `true`         |
| `set_policy_rule`   | `rule`, `value` — the CLI's grammar exactly                      | `false`        |
| `clear_policy_rule` | `rule` optional; omitted means the whole policy                  | `false`        |
| `logout`            | no arguments; ends the session, releasing any pairing            | `false`        |

`rule` mirrors `fibx policy set` with no new grammar: `expiry`, `allowedChains`,
`<chain>.maxValue`, `<chain>.allowedDestinations`. Values are comma-separated
for lists. The three-state read (`Policy | null | "unreadable"`) surfaces
intact; collapsing "unreadable" into "absent" is the fail-open the policy exists
to prevent.

These tools call the same `applyRule` / `removeRule` / `loadPolicy` /
`savePolicy` the CLI uses. No second implementation of the rule grammar.

## Security

The panel can edit the policy, including loosening it. That was a deliberate
decision, taken with the trade-off stated: the policy exists to bound an agent,
and this puts its controls on a surface the agent can cause to appear. Three
things keep it defensible.

**Opening is inert.** The panel binds to a read-only tool. Rendering it changes
nothing and starts nothing.

**Loosening is visible.** `set_policy_rule` and `clear_policy_rule` are
`readOnlyHint: false`, so hosts prompt before running them. A raised cap or a
removed expiry cannot happen without a human seeing the tool call and approving
it.

**A human clicks.** The iframe is driven by the person looking at it. The model
cannot press a button in it; it can only cause the panel to be shown.

**Signing stays out.** `send_tokens` and `swap_tokens` do not appear in this
panel. A transaction-approval screen is a different surface with different
stakes, and it is not in this scope.

## Out of scope

- A swap or transfer confirmation screen. Worth building; a later phase.
- A portfolio dashboard.
- Any change to how the three signing paths work. This adds a view over them.
- A remote or hosted MCP server. Explicitly rejected above.
- Replacing the CLI. Every panel action has a CLI equivalent and keeps it.

## Risks

**The extension may not render.** `ext-apps` issue #671 reports the iframe never
appearing in Claude Desktop and claude.ai. It is one reporter, on an older
protocol revision, through an `mcp-remote` proxy, and Anthropic's own
documentation shows it working — but it is unverified for our case. The build
order below answers this on day one rather than after the panel is finished.

**`ui/open-link` may be refused.** The wallet shortcuts depend on the host
allowing the app to open a `wc:` link. Hosts may disable that capability. If so,
the copyable URI remains and the shortcuts are dropped.

**Host support is uneven.** The extension is supported by Claude, Claude
Desktop, VS Code Copilot, Goose and others, but a host without it simply gets
the existing text result. The panel must degrade to what `get_auth_status`
returns today, not error.

## Build order

Risk first, so an unanswerable question is answered before the expensive work.

1. An empty panel — a heading and one button — bound to `get_auth_status`, run
   in Claude Desktop. Answers whether MCP Apps renders for a local stdio server
   at all. One day. Everything after it is contingent on this.
2. QR, live status, and connect, calling `connect_wallet` and
   `get_connect_status` from inside the iframe.
3. Wallet shortcuts via `ui/open-link`.
4. The four new tools, with the CLI's behaviour mirrored exactly.
5. Policy display and editing in the panel, including the host approval flow for
   loosening.

Step 4 is independent of the panel and stays valuable if step 1 fails.
