import { describe, expect, it } from "vitest";
import { WALLET_PANEL_URI, walletPanelHtml } from "./ui.js";

describe("the wallet panel resource", () => {
	it("uses the ui:// scheme the host looks for", () => {
		expect(WALLET_PANEL_URI.startsWith("ui://")).toBe(true);
	});

	// Proves the tsup loader inlined the built document rather than a path or
	// an empty string — the failure this catches is a build wiring mistake,
	// which no other test would notice.
	it("carries the built panel, inlined", () => {
		expect(walletPanelHtml).toContain("data-fibx-panel");
		expect(walletPanelHtml).not.toMatch(/<script[^>]+src=/);
	});
});
