import { describe, expect, it } from "vitest";
import { WALLET_PANEL_URI, walletPanelHtml } from "./ui.js";

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
});
