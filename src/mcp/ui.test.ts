import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	registerWalletPanel,
	WALLET_PANEL_URI,
	walletPanelHtml,
	registerSwapCard,
	SWAP_CARD_URI,
	swapCardHtml,
} from "./ui.js";

type ResourceRegistry = Record<
	string,
	{
		metadata?: Record<string, unknown>;
		readCallback: () => Promise<{ contents: Array<{ text: string }> }>;
	}
>;

function registeredResources(server: McpServer): ResourceRegistry {
	return (server as unknown as { _registeredResources: ResourceRegistry })._registeredResources;
}

describe("the wallet panel resource", () => {
	it("uses the ui:// scheme the host looks for", () => {
		expect(WALLET_PANEL_URI.startsWith("ui://")).toBe(true);
	});

	// Proves the vitest loader (vitest.config.ts's htmlAsText plugin) inlined
	// the built document rather than a path or an empty string. It says
	// nothing about tsup's own esbuild "text" loader, which the published
	// bundle actually uses and which no test exercises — the two loaders are
	// configured separately and only happen to agree by hand-verification.
	it("carries the built panel, inlined", () => {
		expect(walletPanelHtml).toContain("data-fibx-panel");
		expect(walletPanelHtml).not.toMatch(/<script[^>]+src=/);
	});

	// The panel is inlined into the bundle every fibx invocation loads. The
	// SDK layer sets the floor (~330 KB); the ceiling below leaves ~60 KB for
	// the panel's own code and fails the suite before an accidental import
	// doubles it. There is now one built document, not a pair — see
	// src/mcp/ui.ts — so this is the only size guard left.
	it("stays under the size budget", () => {
		expect(walletPanelHtml.length).toBeLessThan(400_000);
	});

	// The clipboard is the one capability this panel asks for. A host builds
	// the iframe's allow attribute from this declaration; without it, Copy is
	// a button that silently does nothing.
	it("asks the host for clipboard write", () => {
		const server = new McpServer({ name: "t", version: "0" });
		registerWalletPanel(server);

		expect(registeredResources(server)[WALLET_PANEL_URI]?.metadata?._meta).toEqual({
			ui: { permissions: { clipboardWrite: {} } },
		});
	});
});

describe("the swap card resource", () => {
	it("uses the ui:// scheme the host looks for", () => {
		expect(SWAP_CARD_URI.startsWith("ui://")).toBe(true);
	});

	// walletPanelHtml and swapCardHtml are two names for the same built
	// document (src/mcp/ui.ts) — this proves the runtime switch in
	// ui/src/main.tsx compiled its swap-card branch into that document rather
	// than the marker only existing in a file nothing built.
	it("carries the swap card's marker, inlined", () => {
		expect(swapCardHtml).toContain("data-fibx-swap-card");
		expect(swapCardHtml).not.toMatch(/<script[^>]+src=/);
	});

	// Registration is what a host actually calls, so prove the resource
	// resolves to that same marker through registerSwapCard rather than only
	// through the exported constant.
	it("resolves to a document containing the swap card's marker", async () => {
		const server = new McpServer({ name: "t", version: "0" });
		registerSwapCard(server);

		const result = await registeredResources(server)[SWAP_CARD_URI]?.readCallback();
		expect(result?.contents[0]?.text).toContain("data-fibx-swap-card");
	});

	// The entire reason two ui:// URIs still exist even though both resolve
	// to the same document: the panel copies to the clipboard and needs the
	// permission declared; the card copies nothing and opens nothing; and
	// must not carry a capability it has no business holding.
	it("carries different _meta from the panel — no permissions at all", () => {
		const server = new McpServer({ name: "t", version: "0" });
		registerWalletPanel(server);
		registerSwapCard(server);

		const resources = registeredResources(server);
		const panelMeta = resources[WALLET_PANEL_URI]?.metadata?._meta;
		const cardMeta = resources[SWAP_CARD_URI]?.metadata?._meta;

		expect(panelMeta).toEqual({ ui: { permissions: { clipboardWrite: {} } } });
		expect(cardMeta).toBeUndefined();
		expect(cardMeta).not.toEqual(panelMeta);
	});
});
