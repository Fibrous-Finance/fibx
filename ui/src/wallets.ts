export type WalletLink = { name: string; url: string };

/**
 * Same-device pairing: hand the wc: URI to a wallet through its universal
 * link instead of asking someone to scan their own screen. These are the
 * wallets FibX's own README names; the copyable URI remains for every other.
 */
export function walletLinks(uri: string): WalletLink[] {
	const u = encodeURIComponent(uri);
	return [
		{ name: "MetaMask", url: `https://metamask.app.link/wc?uri=${u}` },
		{ name: "Rabby", url: `https://rabby.io/wc?uri=${u}` },
		{ name: "Rainbow", url: `https://rnbwapp.com/wc?uri=${u}` },
	];
}
