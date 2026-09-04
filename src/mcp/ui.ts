import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import documentHtml from "../../ui/dist/index.html";

// vite-plugin-singlefile inlines everything a document imports — including
// the SDK's `App` schema layer, ~330 KB by itself — into ONE self-contained
// HTML file, which esbuild then inlines as text into the server bundle every
// `fibx` invocation loads and `npx fibx` downloads. A second independent
// entry would carry its own copy of that layer (measured at 340 KB for a
// stub that only imported `App`, in
// docs/superpowers/sdd/2026-09-02-panel-buttons-and-swap-card/task-5-report.md)
// and this repo's Vite 8 (Rolldown) toolchain refuses a multi-input build
// with inlining enabled besides. So there is exactly one built document, and
// it decides at runtime (ui/src/main.tsx) whether to render the wallet panel
// or the swap card, from the tool that invoked it.
//
// walletPanelHtml and swapCardHtml are therefore two names for the same
// string, not two files — do not expect editing one to leave the other
// unchanged.
export const WALLET_PANEL_URI = "ui://fibx/wallet-panel.html";
export const SWAP_CARD_URI = "ui://fibx/swap-card.html";

/** The one built document, as the host will receive it. Exported for tests. */
export const walletPanelHtml: string = documentHtml;
export const swapCardHtml: string = documentHtml;

export function registerWalletPanel(server: McpServer): void {
	registerAppResource(
		server,
		WALLET_PANEL_URI,
		WALLET_PANEL_URI,
		{
			mimeType: RESOURCE_MIME_TYPE,
			// Hosts gate browser capabilities behind a declared permission and
			// build the iframe's `allow` attribute from it. Without this the
			// clipboard call rejects and a Copy button does nothing at all.
			// Declaring is necessary and not sufficient — the app still feature-
			// detects, because a host may refuse.
			_meta: { ui: { permissions: { clipboardWrite: {} } } },
		},
		async () => ({
			contents: [
				{ uri: WALLET_PANEL_URI, mimeType: RESOURCE_MIME_TYPE, text: walletPanelHtml },
			],
		})
	);
}

export function registerSwapCard(server: McpServer): void {
	registerAppResource(
		server,
		SWAP_CARD_URI,
		SWAP_CARD_URI,
		// No permissions: the card copies nothing and opens nothing. This is
		// the entire reason two ui:// URIs still exist even though both serve
		// the same document — one iframe must not carry a capability (like
		// clipboard write) the other has no business holding.
		{ mimeType: RESOURCE_MIME_TYPE },
		async () => ({
			contents: [{ uri: SWAP_CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: swapCardHtml }],
		})
	);
}
