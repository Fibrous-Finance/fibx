import { CHAIN_NAMES, SUPPORTED_CHAINS } from "../chain/constants.js";

/** Methods this client actually calls. */
const METHODS = ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"];

const EVENTS = ["chainChanged", "accountsChanged"];

export function caip2(chainId: number): string {
	return `eip155:${chainId}`;
}

/**
 * Chains are proposed as OPTIONAL. A required namespace the wallet does not
 * recognise fails the entire pairing, and most wallets have neither Monad nor
 * HyperEVM configured — the user would be unable to connect at all rather than
 * connecting for Base and adding the others later.
 */
export function buildOptionalNamespaces(): {
	eip155: { chains: string[]; methods: string[]; events: string[] };
} {
	return {
		eip155: {
			chains: CHAIN_NAMES.map((name) => caip2(SUPPORTED_CHAINS[name]!.id)),
			methods: [...METHODS],
			events: [...EVENTS],
		},
	};
}

/** CAIP-10 accounts look like `eip155:8453:0xabc…`; the address is the last segment. */
export function firstAccountAddress(
	namespaces: Record<string, { accounts: string[] }>
): string | null {
	const account = namespaces.eip155?.accounts?.[0];
	if (!account) return null;
	const address = account.split(":")[2];
	return address ?? null;
}

export function sessionHasChain(
	namespaces: Record<string, { accounts: string[] }>,
	chainId: number
): boolean {
	const prefix = `${caip2(chainId)}:`;
	return (namespaces.eip155?.accounts ?? []).some((a) => a.startsWith(prefix));
}
