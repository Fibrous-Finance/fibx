import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import panelHtml from "../../ui/dist/index.html";
import swapCardHtmlRaw from "../../ui/dist/swap-card.html";

export const WALLET_PANEL_URI = "ui://fibx/wallet-panel.html";

/** The built panel, as the host will receive it. Exported for tests. */
export const walletPanelHtml: string = panelHtml;

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

export const SWAP_CARD_URI = "ui://fibx/swap-card.html";

/** The built swap card, as the host will receive it. Exported for tests. */
export const swapCardHtml: string = swapCardHtmlRaw;

export function registerSwapCard(server: McpServer): void {
	registerAppResource(
		server,
		SWAP_CARD_URI,
		SWAP_CARD_URI,
		// No permissions: the card copies nothing and opens nothing.
		{ mimeType: RESOURCE_MIME_TYPE },
		async () => ({
			contents: [{ uri: SWAP_CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: swapCardHtml }],
		})
	);
}
