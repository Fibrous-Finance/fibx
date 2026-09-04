import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWalletPanel, WALLET_PANEL_URI, walletPanelHtml } from "./ui.js";

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
	// doubles it.
	it("stays under the size budget", () => {
		expect(walletPanelHtml.length).toBeLessThan(400_000);
	});

	// The clipboard is the one capability this panel asks for. A host builds
	// the iframe's allow attribute from this declaration; without it, Copy is
	// a button that silently does nothing.
	it("asks the host for clipboard write", () => {
		const server = new McpServer({ name: "t", version: "0" });
		registerWalletPanel(server);

		const registered = (
			server as unknown as {
				_registeredResources: Record<string, { metadata?: Record<string, unknown> }>;
			}
		)._registeredResources[WALLET_PANEL_URI];

		expect(registered?.metadata?._meta).toEqual({
			ui: { permissions: { clipboardWrite: {} } },
		});
	});
});
