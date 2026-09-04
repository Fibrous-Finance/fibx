import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import documentHtml from "../../ui/dist/index.html";

// vite-plugin-singlefile inlines everything the document imports — including
// the SDK's `App` schema layer, ~330 KB by itself — into ONE self-contained
// HTML file, which esbuild then inlines as text into the server bundle every
// `fibx` invocation loads and `npx fibx` downloads. A second entry would carry
// its own copy of that layer (measured at 340 KB for a stub that only imported
// `App`), so there is exactly one built document and exactly one ui:// URI.
export const APP_URI = "ui://fibx/app.html";

/** The one built document, as the host will receive it. Exported for tests. */
export const appHtml: string = documentHtml;

export function registerApp(server: McpServer): void {
	registerAppResource(
		server,
		APP_URI,
		APP_URI,
		{
			mimeType: RESOURCE_MIME_TYPE,
			// The pairing view copies the wc: URI. Declaring is necessary and not
			// sufficient — the app still feature-detects, and falls back to
			// execCommand("copy"), because a host may refuse.
			_meta: { ui: { permissions: { clipboardWrite: {} } } },
		},
		async () => ({
			contents: [{ uri: APP_URI, mimeType: RESOURCE_MIME_TYPE, text: appHtml }],
		})
	);
}
