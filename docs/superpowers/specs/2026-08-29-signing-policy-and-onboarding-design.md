# Signing policy and onboarding — design

**Date:** 2026-08-29
**Status:** approved for planning
**Scope:** Bound every signing path with a local policy, and route new users to the path that fits them.

## Problem

FibX now offers three ways to sign, and they differ on one axis: who holds the
key, and what bounds it.

| Path | Key held by | Runs unattended | Bounded by |
|---|---|---|---|
| `auth login` (Privy) | Privy's infrastructure | yes | Privy signing policy |
| `auth import` (private key) | this machine, encrypted | yes | **nothing** |
| `auth connect` (WalletConnect) | the user's own wallet | no | the human |

Two problems follow.

**The imported-key path has no limits at all.** Anyone who runs `fibx auth
import` gets an agent with unbounded authority over their funds. That is the
failure mode FibX's own positioning names — Bankr was compromised at the prompt
layer in May 2026, which is the argument for putting limits in the signing layer
instead. FibX makes that argument while shipping a path that has none.

**Nothing helps a new user choose.** `fibx auth` prints a list of four
subcommands with one-line descriptions. Worse, the unauthenticated error in
`requireSession()` reads "Run `fibx auth login <email>` first" — it names one of
the three paths, so every new user is steered to Privy without learning the other
two exist.

## Goal

One policy, enforced at the last gate on every path, and an onboarding flow that
asks what someone needs and lands them on the path that provides it — including
telling them plainly when what they want does not exist yet.

## What the research settled

Phase 2 was originally scoped as ERC-7715 session keys: the user keeps their own
wallet *and* grants FibX bounded, unattended authority. That is the one
combination none of the three paths offers, and it turns out not to be available.

Measured or verified on 2026-08-29:

- **EIP-7702 is live on all three chains.** A well-formed type-4 transaction with
  a deliberately unrecoverable signature was rejected at the *signature* layer by
  Base, Monad and HyperEVM alike — meaning each decoded the `authorizationList`.
  Base named the type outright (`rlp: too few elements for types.SetCodeTx`).
  This corrects an earlier reading of HyperEVM's block header: `requestsHash`
  comes from EIP-7685, not 7702, and its absence proves nothing.
- **A JSON-RPC account cannot sign an EIP-7702 authorization.** There is no RPC
  method for it, viem will not add one until an ERC exists, and wallets
  deliberately keep code-attachment inside the wallet — the same reasoning that
  retired `eth_sign`. So FibX cannot have a user's connected wallet delegate to a
  contract FibX controls.
- **Wallets grant exactly the methods a session proposes.** The live Zerion
  session approved `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`
  — our three, no extras. Since we propose them as `optionalNamespaces`, the
  approved list doubles as a capability probe.
- **ERC-7715 needs a smart account,** and Reown's Smart Sessions — the only
  WalletConnect-adjacent implementation — is still in the `experimental` package
  two years on, requires a Reown-hosted `CosignerService` keyed by project id,
  and ships as AppKit UI components. A hosted co-signer reintroduces exactly the
  third party this work exists to remove, and none of it is headless.

The conclusion is that the third combination is unavailable today, not that it is
undesirable. This design takes the two paths that *are* available and makes both
honest, and turns the negative result into something onboarding can explain.

## Non-goals

- **ERC-7715 session keys.** Revisit when a wallet exposes
  `wallet_grantPermissions` over a WalletConnect session without a hosted
  co-signer. Detecting that will be cheap when the time comes — a
  `sessionHasMethod` sibling of the existing `sessionHasChain`, reading the
  approved method list the wallet already returns — but it is not written here,
  because nothing in this phase would call it.
- **Signed intents and an executor.** Signing an EIP-712 intent that a service
  executes later would give all three properties at once, and
  `eth_signTypedData_v4` is already approved. But it needs a settlement contract
  — Fibrous's router does not accept signed orders — plus an operated service.
  That is a product line, not a phase, and it is the limit-order product Fibrous
  itself has not shipped.
- **A daily cumulative spend cap.** It needs a persistent ledger, and with it the
  questions of when a day starts, what timezone, what happens when the file is
  deleted (the limit resets, so it is trivially bypassed), and concurrent
  commands. The per-transaction cap already bounds one bad decision; the contract
  allowlist bounds where funds can go and expiry bounds for how long. Add it when
  someone asks.
- **Changing any existing path's behaviour.** `auth login`, `auth import` and
  `auth connect` keep working exactly as they do.

## Architecture

### One policy, two enforcement adapters

The policy itself is a pure function: `evaluate(transaction, policy)` returns
either permission or a named violation. It has no I/O and no knowledge of which
path is signing.

It is called from two places, because the three paths expose the transaction at
two different layers:

- **The account paths** — imported key and Privy — return a viem account whose
  `signTransaction` receives the readable fields. viem's `toAccount` wraps an
  existing account, so the adapter asks the policy first and delegates on
  permission.
- **The WalletConnect path** returns a bare address plus a `custom()` transport,
  so the fields appear in the provider's `eth_sendTransaction` params.
  `provider.ts` already funnels every call through one `request()`, which is
  where the same policy is asked.

Two adapters rather than one wrapper around the wallet client, for a reason that
is about enforcement rather than tidiness: both of these are the **last gate
before the network**, and nothing can route around them. Wrapping the client's
`sendTransaction` would miss `writeContract`, which Aave uses and which reaches
the transport through viem's own action rather than through the wrapped method.

The policy logic lives in one module and is fully unit-testable; each adapter is
a few lines.

### Why the policy binds all three paths

For the imported key it is the *only* bound. For Privy it is defence in depth,
and it fails locally with a clearer message than a server-side rejection. For
WalletConnect it means an agent attempting something absurd is stopped on this
machine, with a readable reason, instead of pushing a confusing request to the
user's phone.

One enforcement rule, one mental model, three paths.

## The policy

### Rules

Every rule is a pure function of the transaction. All are optional; an absent
rule permits.

| Rule | Shape | Bounds |
|---|---|---|
| Allowed chains | list of chain names | which networks may be signed for |
| Per-transaction native cap | per chain, decimal native units | the size of one mistake |
| Allowed destinations | per chain, list of addresses | where value and calls may go |
| Expiry | ISO date | how long the policy is honoured |

"Destinations" rather than "contracts" because the rule reads the transaction's
`to` and does not care what is deployed there: a swap through a Fibrous router
and a transfer to a friend's EOA are both checked the same way. One rule covers
both, and naming it after the field keeps that obvious.

Expiry bounds the policy, not the session. A policy past its date refuses
everything rather than permitting everything — the opposite would turn a
forgotten limit into a silent removal of all limits.

### Storage

`policy.json`, beside `session.json` in `paths.config`, mode `0600`. Deliberately
separate from the session: a policy outlives the session it was set under, and
switching auth paths should not silently drop the user's limits.

A file that exists but cannot be parsed **refuses every transaction**. The
alternative — treating it as absent — turns a corrupted or half-edited limit into
no limit at all, which is the one failure direction a security control must not
have. The message says the file is unreadable and names its path, so the user can
fix or clear it.

### Default

**No policy on a fresh install**, and the absence is stated rather than silent.
Imposing an unrequested cap would stop a transaction the user never asked us to
stop, in a place they would not think to look. Onboarding asks instead, and the
imported-key branch offers to set one because that path has no other bound.

### What this does not protect against

A local policy file guarding a local key is advisory. Anything that can read the
key can edit the policy, so this is worth nothing against malware, and the
documentation will say so in those words.

The threat it does meet is the one FibX's positioning is about: a model that
misbehaves, or a prompt injection that tells it to. "Drain the wallet" hits the
cap. That is a real and different guarantee from "your machine is secure", and
conflating the two would be dishonest.

### Reading and changing it: `fibx policy`

The error message above tells the user how to change a limit, so the command it
names has to exist. Three subcommands, following the shape of the existing
`fibx config`:

```
fibx policy show                        print the active policy, or say there is none
fibx policy set <rule> <value>          set one rule
fibx policy clear [rule]                remove one rule, or the whole policy
```

`show` is the important one: a limit the user cannot read is a limit they will
be surprised by. It prints every rule and, when no policy exists, says so in the
words the onboarding used — that this path has no limits and how to add some.

`clear` with no argument removes the policy entirely and warns first, since on
the imported-key path it is the only bound that exists.

Rules are addressed as `<chain>.<rule>` (`base.maxValue`) or bare for the
chain-independent ones (`expiry`). `set` validates the value against the rule's
type and refuses a malformed one with the same clarity as a blocked
transaction — a policy that silently stores a value it will not honour is worse
than no policy.

Editing `policy.json` by hand stays supported and is not fought: it is the
user's machine and their file. `show` reads whatever is there, and a file that
fails to parse refuses transactions rather than being ignored, for the same
reason expiry does.

## Onboarding

### `fibx auth setup`

A dedicated command rather than making a bare `fibx auth` interactive, which
would surprise scripts. It runs only on a TTY; an agent cannot answer a prompt,
so the MCP surface keeps the explicit tools it already has.

It asks one question:

```
  How should FibX sign?

  1  Connect a wallet I already have
     MetaMask, Rabby, Rainbow, Phantom. Every transaction is approved on your phone.

  2  Create a wallet FibX can use on its own
     Runs while you are away. The key lives with Privy, bounded by a signing policy.

  3  Import a private key
     Runs while you are away, entirely on this machine. You set the limits.

  ?  I want my own wallet AND unattended operation
```

Each answer runs the corresponding existing command. Answer 3 then offers to set
a policy, because that path has no other bound.

The `?` branch is what turns the research's negative result into an answer: it
explains that this combination needs ERC-7715, that wallets do not yet expose it
over WalletConnect, and which of the three comes closest to what they wanted.

The routing — which answer leads to which path — is a pure function, so it is
testable without driving a prompt.

### The unauthenticated message

`requireSession()` currently says "Run `fibx auth login <email>` first", naming
one path and hiding two. It changes to point at `fibx auth setup`, which is the
one place that describes all three.

## Error handling

A blocked transaction raises `FibxError` with a new `ErrorCode.POLICY_BLOCKED`.
None of the existing codes fits: this is not a wallet error, a validation error
or an unsupported chain, and to the user it is a categorically different event
from a network failure — the transaction was well-formed and refused on purpose.

The message names the rule, the limit and the attempt, then how to change it:

```
✖ [POLICY_BLOCKED] Transaction exceeds the per-transaction cap on base:
   0.5 ETH attempted, 0.05 ETH allowed.
   Change it with `fibx policy set base.maxValue 0.1`, or see all rules with `fibx policy show`.
```

Because the WalletConnect adapter sits inside viem's transport, its throw is
wrapped by viem — `formatError` already walks the `cause` chain for a
`FibxError`, so the typed error survives on that path too.

## Testing

- **The evaluator is pure**, so it gets table-driven tests: each rule permitting
  and refusing, boundary values at exactly the cap, an absent rule permitting,
  and an empty policy permitting everything.
- **Each adapter gets one test proving the gate holds** — that a violation stops
  before the signature or the relay request, not merely that the evaluator said
  no. This is the assertion that matters; a correct rule behind a gate nothing
  calls is worth nothing.
- **Loading is tested separately from evaluating**, because the two failure
  directions differ: an absent file permits, an unparseable one refuses. Both get
  a test, and the refusing case is the one a regression would quietly invert.
- **`fibx policy set` validation** is tested on the values it must reject — a
  cap that is not a number, an unknown chain, an unknown rule name, a malformed
  date — since storing a value the evaluator will not honour is the failure this
  command exists to prevent.
- **The onboarding routing** is a pure function and is tested directly. The
  prompt itself stays thin enough not to need one, the same judgement made for
  `auth connect`, and is covered by manual verification.
- **Existing paths must not change.** The suite already covers Privy,
  private-key and WalletConnect signer selection; those tests must pass
  unmodified, which is what proves the policy is additive.

## Manual verification

No unit test proves the whole thing works, so the phase is not done until:

1. A policy with a low cap refuses a real transfer on each of the three paths,
   with the message above.
2. Raising the cap lets the same transfer through.
3. An expired policy refuses, and says so in those terms.
4. A hand-corrupted `policy.json` refuses, and names the file.
5. `fibx policy show` reports the active rules, and reports their absence
   usefully when there is no policy.
6. `fibx auth setup` routes all four answers correctly, including `?`.
7. With no policy set, every path behaves exactly as it does today.
