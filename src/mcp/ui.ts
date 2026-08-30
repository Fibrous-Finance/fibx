import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import panelHtml from "../../ui/dist/index.html";

export const WALLET_PANEL_URI = "ui://fibx/wallet-panel.html";

/** The built panel, as the host will receive it. Exported for tests. */
export const walletPanelHtml: string = panelHtml;

export function registerWalletPanel(server: McpServer): void {
	registerAppResource(
		server,
		WALLET_PANEL_URI,
		WALLET_PANEL_URI,
		{ mimeType: RESOURCE_MIME_TYPE },
		async () => ({
			contents: [
				{ uri: WALLET_PANEL_URI, mimeType: RESOURCE_MIME_TYPE, text: walletPanelHtml },
			],
		})
	);
}
