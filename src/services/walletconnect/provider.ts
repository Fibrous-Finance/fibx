import type { ChainConfig } from "../chain/constants.js";
import { getSignClient } from "./client.js";
import { getActiveSession } from "./connect.js";
import { caip2, sessionHasChain } from "./namespaces.js";
import { ErrorCode, FibxError } from "../../lib/errors.js";
import { assertAllowed } from "../policy/enforce.js";

/** Requests that only make sense against the wallet's own key. */
const READ_ONLY_REJECT = new Set(["eth_signTransaction"]);

export interface WalletConnectProvider {
	request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/**
 * A wallet's JSON-RPC response — e.g. rejecting a transaction — rejects
 * `signClient.request` with a plain `{ code, message }` object, not an Error
 * instance: @walletconnect/jsonrpc-provider's requestStrict rejects with the
 * error straight off the wire. A relay or socket failure throws a real Error
 * instead, so the two are told apart by shape rather than guessed at.
 */
function isWalletRejection(error: unknown): error is { code: number; message: string } {
	return (
		typeof error === "object" &&
		error !== null &&
		!(error instanceof Error) &&
		typeof (error as { code?: unknown }).code === "number" &&
		typeof (error as { message?: unknown }).message === "string"
	);
}

/**
 * An EIP-1193 shim viem's `custom()` transport can wrap. Every request is
 * pinned to one chain, because a WalletConnect session can hold several and the
 * wallet needs to be told which one this call belongs to.
 */
export function createWalletConnectProvider(
	topic: string,
	chain: ChainConfig
): WalletConnectProvider {
	const chainId = caip2(chain.id);

	async function send(method: string, params: unknown[]): Promise<unknown> {
		const signClient = await getSignClient();
		try {
			return await signClient.request({ topic, chainId, request: { method, params } });
		} catch (error) {
			// The most common outcome here is the user declining in their wallet;
			// that must not escape as a raw, non-FibxError rejection.
			if (isWalletRejection(error)) {
				// Wallets are not obliged to say why. Zerion sends an empty
				// message on Cancel, which left the sentence trailing a colon.
				const reason = error.message.trim();
				throw new FibxError(
					ErrorCode.WALLET_ERROR,
					reason
						? `Wallet rejected the request: ${reason}`
						: "Wallet rejected the request."
				);
			}
			throw new FibxError(
				ErrorCode.WALLET_ERROR,
				`WalletConnect request failed: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}

	/**
	 * A session only carries the chains the wallet approved at pairing time.
	 * signClient.request validates chainId and method against those namespaces
	 * locally and throws before anything reaches the relay, so a missing chain
	 * cannot be repaired by sending it a request scoped to that chain — and
	 * wallet_addEthereumChain is not a method this client negotiates either, so
	 * it would fail the same local check. Tell the user what to do instead of
	 * pretending the wallet refused a request it was never asked.
	 */
	async function ensureChain(): Promise<void> {
		const session = await getActiveSession(topic);
		if (sessionHasChain(session.namespaces, chain.id)) return;

		throw new FibxError(
			ErrorCode.UNSUPPORTED_CHAIN,
			`Your wallet did not approve ${chain.name} for this session. Add ${chain.name} ` +
				`in your wallet, then run \`fibx auth connect\` again so the new chain is ` +
				`included.`
		);
	}

	return {
		async request({ method, params = [] }) {
			// viem asks the transport for the chain id before every
			// eth_sendTransaction — and writeContract routes through
			// sendTransaction, so Aave's writes ask too. For a bare-address
			// (json-rpc) account with a chain on the client it is the only extra
			// method viem emits. The session negotiates signing methods only, so
			// signClient.request() would reject eth_chainId locally against the
			// approved namespaces and no transaction could ever complete.
			//
			// The provider is pinned to one chain, so it answers without a relay
			// round-trip — and `chain` is also the only correct answer: a session
			// can hold several chains, viem compares this against the client's
			// chain and refuses to send on a mismatch, and the wallet's own
			// current chain need not be the one this request is CAIP-2 scoped to.
			if (method === "eth_chainId") return `0x${chain.id.toString(16)}`;

			if (READ_ONLY_REJECT.has(method)) {
				throw new FibxError(
					ErrorCode.WALLET_ERROR,
					`${method} is not available over WalletConnect. The wallet signs and ` +
						`broadcasts in one step, so FibX uses eth_sendTransaction instead.`
				);
			}

			if (method === "eth_sendTransaction") {
				// The wallet path has no local account, so the fields arrive as
				// hex in the params. Checking here means a refusal never becomes
				// a confusing request on the user's phone.
				const tx = (params[0] ?? {}) as { to?: string; value?: string };
				assertAllowed({
					chain: chain.name,
					to: tx.to,
					value: tx.value ? BigInt(tx.value) : 0n,
				});

				await ensureChain();
			}

			return send(method, params);
		},
	};
}
