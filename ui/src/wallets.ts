/**
 * Same-device pairing. The three brand universal links this replaces were
 * mobile-only: `openLink` opens the host's default browser rather than an app,
 * so on a desktop they landed on a "open this in your app" page and reported
 * success — a dead end with no error to react to.
 *
 * A bare `wc:` URI is what desktop wallets register as a protocol handler. If
 * the host refuses a non-http scheme it answers `isError`, which the caller
 * uses to hide the button rather than leave it dead.
 */
export function walletLink(uri: string): string {
	return uri;
}
