# WalletConnect signer — design

**Date:** 2026-08-29
**Status:** approved for planning
**Scope:** Phase 1 only — add WalletConnect as a third signing path in the `fibx` CLI and its MCP server.

## Problem

FibX offers two ways to hold a key, and neither lets someone use the wallet they
already have:

- `fibx auth login <email>` mints a **new** Privy wallet. It is app-managed
  (owner-less), so the server's Privy credentials are the full administration
  boundary, and the attached policy denies `exportPrivateKey` — funds that land
  there can only leave through `fibx send`.
- `fibx auth import` asks the user to paste a raw private key. Anyone holding a
  real wallet cannot comply: MetaMask, Rabby and Ledger do not export keys, and
  should not.

The result is that FibX cannot be used with a wallet the user already trusts.

## Goal

`fibx auth connect` pairs the CLI with the user's own wallet over WalletConnect
v2. Signing requests appear on their phone. Nothing else changes: the Privy and
private-key paths keep working exactly as they do today, and no existing session
is invalidated.

## Non-goals for this phase

Named explicitly so the plan does not drift into them:

- Making WalletConnect the default. It ships as a third option; flipping the
  default is a separate one-line change made once this is proven.
- Retiring Privy. Blocked on the fund-export problem below, and on the autonomy
  gap that only ERC-7715 session keys close.
- Telegram bot integration. The bot spawns headless per-user MCP processes with
  no place to show a QR code. It keeps using Privy and is unaffected.
- MCP Apps UI. The connect tool is shaped so an app can drive it later, but no
  app is built here.
- ERC-7715 session keys (Phase 2) and anything touching `fibx-server`.

## Architecture

### The seam

`src/services/chain/client.ts` already concentrates every signer decision in one
47-line file. `getWalletClient()` returns a viem wallet client and every caller —
swap, send, Aave, three MCP handlers — consumes it without knowing where the key
lives. That stays true; WalletConnect becomes a third branch.

### viem integration: transport, not account

The Privy path builds a viem **account** whose `signTransaction` calls the
backend, and viem then broadcasts the signed payload with `eth_sendRawTransaction`.
That shape does not work over WalletConnect: **MetaMask does not implement
`eth_signTransaction` over WalletConnect**, and support across other wallets is
inconsistent. What wallets do implement is `eth_sendTransaction` — the wallet
signs _and_ broadcasts.

So the WalletConnect branch builds the client the other way round:

```ts
createWalletClient({
	account: session.walletAddress, // an address, not a local account
	chain: chain.viemChain,
	transport: custom(walletConnectProvider),
});
```

Passing `account` as a bare address makes viem route `sendTransaction` through
the transport as `eth_sendTransaction` instead of signing locally. The provider
is a small EIP-1193 shim that forwards requests over the WalletConnect session.

This is why the alternative — a custom viem account mirroring
`toPrivyViemAccount` — is rejected rather than merely not chosen: it would
require `eth_signTransaction` and would fail on the most common wallet.

**`eth_chainId` is answered locally, not forwarded.** A bare-address (`json-rpc`)
account leaves transaction preparation to the wallet, so viem emits exactly two
methods for both `sendTransaction` and `writeContract`: `eth_chainId`, then
`eth_sendTransaction`. No gas, nonce, fee or block calls reach the transport.
`eth_chainId` is not one of the methods this client negotiates, and
`signClient.request()` validates the method against the approved namespaces
locally — so forwarding it fails before the relay, and no transaction of any
kind can complete. The provider is pinned to one chain, so it answers from that
chain. That is also the only correct answer rather than a shortcut: a session can
hold several chains, viem compares the value against the client's chain and
refuses to send on a mismatch, and the wallet's own current chain need not be the
one the request is CAIP-2 scoped to.

Negotiating `eth_chainId` instead is rejected: it would put the wallet's current
chain in the answer, which is the wrong value, and cost a relay round-trip per
transaction to get it.

### `getWalletClient()` becomes async

Initialising the WalletConnect `SignClient` is asynchronous. The alternative — a
module-level singleton with a synchronous accessor that throws when uninitialised
— hides an ordering requirement in global state, and the failure surfaces far
from its cause.

All six production callers are already inside `async` functions, so awaiting is
mechanical:

- `src/commands/trade/swap.ts:48`
- `src/commands/wallet/send.ts:38`
- `src/commands/defi/aave.ts:172`
- `src/mcp/handlers/trade.ts:42`
- `src/mcp/handlers/wallet.ts:64`
- `src/mcp/handlers/defi.ts:20` and `:88`

### New module

```
src/services/walletconnect/
  storage.ts     IKeyValueStorage backed by a 0600 file in paths.config
  client.ts      SignClient singleton — one relay connection per process, and
                 its shutdown
  namespaces.ts  CAIP-2 construction, account and chain extraction
  connect.ts     Session lifecycle: produce a URI, await approval, resolve a
                 session, and tear one down on logout
  provider.ts    EIP-1193 shim over a live session, pinned to one chain
  qr.ts          QR rendering — terminal string, and a data URI for MCP hosts
```

Each file is separately testable, which is what decided the split: storage and
namespaces are pure and need no relay, and `connect` and `provider` can be tested
against a mocked `SignClient` rather than a live one.

## Data flow

### Connecting

1. `fibx auth connect` initialises `SignClient` with the project id.
2. It calls `connect()` with **`optionalNamespaces`** covering
   `eip155:8453`, `eip155:999`, `eip155:143`.
   Optional rather than required is deliberate: `requiredNamespaces` makes the
   whole pairing fail when the wallet does not know one of the chains, which is
   the common case for Monad and HyperEVM.
3. The returned URI is rendered as a QR code in the terminal.
4. On approval the session yields a topic and the approved accounts.
5. `session.json` is written with `type: "walletconnect"`, the address, and the
   session topic.

### Signing

`walletClient.sendTransaction()` → viem emits `eth_sendTransaction` → the
provider forwards it over the session topic → the wallet prompts, signs,
broadcasts, and returns the hash.

### Chain coverage

Today the Privy wallet signs for any allowed chain and the user never notices.
With WalletConnect the user's own wallet must know the chain, which introduces a
failure mode that does not exist now.

At transaction time, if the target chain is absent from the approved session, the
provider fails with a typed error that names the chain and tells the user to add
it in their wallet and re-pair — never a bare RPC failure.

An earlier draft had the provider attempt `wallet_addEthereumChain` followed by
`wallet_switchEthereumChain`. That cannot work, and the Task 5 review proved it
against the installed SDK: `signClient.request()` validates the chain id and the
method against the session's namespaces _locally_ and throws before anything
reaches the relay. A repair request is by definition scoped to the chain that is
missing, so it fails that check every time — and `wallet_addEthereumChain` is not
among the methods this client negotiates, so it would fail the method check too.
The wallet was never contacted, which made the old message ("refused to add it")
untrue as well as useless.

Negotiating those methods and scoping the repair to a chain the session already
carries would be the way to make it work. It is not worth it yet: few wallets
expose EIP-3085 over a WalletConnect session, the fallback would fire almost
always, and none of it can be verified without a live wallet. Revisit once
Task 11's manual pairing gives us something to develop against.

## Nonce handling

`AaveService` routes eight calls through `sendWithNonce()`, which asks
`NonceManager` for a nonce read under lock at `blockTag: "pending"` and passes it
explicitly into `writeContract`. That is correct when FibX broadcasts. It is
wrong over WalletConnect, where the wallet assigns the nonce; forcing one invites
a conflict.

`AaveService` receives a `WalletClient`, not the session, so the capability is
passed to it:

```ts
setWalletClient(client: WalletClient, opts?: { managesOwnNonce?: boolean })
```

`sendWithNonce()` then calls straight through with an undefined nonce when the
remote wallet owns it — viem omits the field — and keeps the existing
`NonceManager` path otherwise. The nonce rewrite from the hardening sprint is
untouched for the Privy and private-key paths.

A predicate beside `getWalletClient()` keeps the rule in one place:

```ts
export function managesOwnNonce(session: Session): boolean;
```

## Session storage

`session.json` gains one enum member and one optional field:

```ts
type: z.enum(["privy", "private-key", "walletconnect"]).default("privy"),
wcTopic: z.string().optional(),
```

Widening an enum is backward compatible: sessions written by earlier versions
still parse, and no migration runs.

`SignClient` keeps its own key-value store. It is pointed at `paths.config`
alongside `session.json` and created with the same `0600` permissions, so
pairing material is not left world-readable in a default location.

## Logout teardown

Added after the whole-branch review found this missing. It is a gap in this
document rather than a deviation from it: nothing here or in the plan said what
logout owes a WalletConnect session, so `fibx auth logout` did what it always
did — delete `session.json` — and that is not a logout for this path.

A WalletConnect session is two-sided. Deleting `session.json` ends FibX's half
and leaves the other half untouched: the user's wallet keeps listing FibX as an
active connection, and `walletconnect.json` keeps the symmetric keys, session
topic and pairing material that authorise it, indefinitely, under the message
"Logged out. Session cleared."

So logout, when `session.type === "walletconnect"`:

1. calls `signClient.disconnect({ topic, reason: USER_DISCONNECTED })`, so the
   wallet drops the session and stops showing FibX as connected;
2. removes `walletconnect.json` in full — after the disconnect, so SignClient's
   own write to the store cannot recreate what is being removed.

Both steps are **best-effort, and neither may block the logout**. The user asked
to leave: an unreachable relay, or a session the wallet has already dropped, must
not leave them logged in. The local session is cleared in a `finally`, so it goes
whatever happened to the remote half — and the local key material is the half
that matters if only one can be done.

The other two auth paths are untouched: they have no remote half and no store,
and `logout` reaches none of this for them.

## MCP surface

MCP tools are request/response, so the connect tool must not block for however
long the user takes to scan. Two tools, named to match the existing
`get_auth_status` / `send_tokens` convention:

- `connect_wallet` returns `{ uri, qrDataUri, pairingId }` immediately.
- `get_connect_status` polls until approved, rejected, or expired.

`get_auth_status` already tells an agent to call it first; it gains the session
type so the model knows which signing path is active and whether a human has to
approve each transaction.

`qrDataUri` is what lets an MCP App render the code later: the Apps spec allows
`img-src 'self' data:`, so a data URI displays inside the sandbox without any
external request.

## Error handling

Every case below produces a typed `FibxError`, never a bare RPC failure:

| Case                                        | Behaviour                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| User rejects the pairing                    | Clear message; no session written                                                                                             |
| Pairing expires                             | Message names the expiry and how to retry                                                                                     |
| Session disconnected or expired at use time | Detected before signing; tells the user to run `fibx auth connect`                                                            |
| Chain absent from session                   | Fail before contacting the wallet, with a typed `UNSUPPORTED_CHAIN` naming the chain and the manual step — see Chain coverage |
| Relay unreachable                           | Existing retry helper, then a message distinguishing network failure from rejection                                           |
| User rejects a signature                    | Distinguished from a failure — this is a normal outcome                                                                       |

## Testing

TDD throughout; each test names the production change that breaks it.

- Session schema accepts `walletconnect`; sessions written by prior versions
  still parse and no migration runs.
- `getWalletClient()` returns an address-backed client for a WalletConnect
  session, and a local-account client for the other two.
- The provider maps `sendTransaction` to `eth_sendTransaction` — asserted against
  a fake EIP-1193 provider, not a mocked relay.
- `AaveService` omits the nonce when `managesOwnNonce` is set and still uses
  `NonceManager` otherwise.
- A chain missing from the session yields the named `UNSUPPORTED_CHAIN` error
  without any request reaching the wallet.
- Real viem, driven through the real provider against a `SignClient` stub that
  applies `@walletconnect/utils`' own namespace validators, completes both
  `sendTransaction` and `writeContract` — and relays nothing outside the
  negotiated method set. This is the test that spans the two mock boundaries the
  unit tests stop at, and the standing guard for any change to the method list.
- `closeSignClient()` stops the heartbeat as well as closing the transport, is
  idempotent, no-ops when nothing was opened, and clears the memo.
- Logout disconnects the wallet's side and removes the pairing store, and clears
  the local session even when that teardown fails.
- QR encoding round-trips the pairing URI.

End-to-end verification is manual and required before this is called done: pair a
real wallet from a phone and sign one transaction on Base.

## Project id

`1c19af9778708c97acf595733be5f30d`, overridable through `FIBX_WC_PROJECT_ID`.

It ships inside the published bundle and is therefore public. That is normal for
WalletConnect dapps, but the origin allowlist Reown recommends does not apply to
a CLI, which has no origin. The practical exposure is quota consumption by third
parties; the remedy is to rotate the id and publish.

## Known consequences

- **Autonomy regresses on this path.** Today an agent holding a Privy session
  trades without a human present. Over WalletConnect every transaction needs a
  tap. Users who need autonomy stay on Privy until ERC-7715 session keys land in
  Phase 2. This is the reason the default is not being flipped here.
- **Bundle size grows.** `tsup` runs with `noExternal: [/.*/]`, so
  `@walletconnect/sign-client` is inlined into the single 1.8 MB artifact.
  Accepted deliberately; measured after the first build.
- **Privy's fund lock is still open.** Wallets are owner-less and the policy
  denies `exportPrivateKey`, so retiring Privy without first opening export — or
  sweeping users out — would strand funds. Out of scope here, but it gates
  Phase 3 and is recorded so it is not rediscovered late.
