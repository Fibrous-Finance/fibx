import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { APP_URI, appHtml, registerApp } from "./ui.js";

describe("the app resource", () => {
	it("uses the ui:// scheme the host looks for", () => {
		expect(APP_URI.startsWith("ui://")).toBe(true);
	});

	// The vitest html-as-text loader (vitest.config.ts) inlined the built
	// document rather than a path or an empty string.
	it("carries the built document, inlined", () => {
		expect(appHtml).toContain("data-fibx-app");
		expect(appHtml).not.toMatch(/<script[^>]+src=/);
	});

	// Bytes, not UTF-16 code units: the constraint is download weight on every
	// `npx fibx`, and the two differ by ~18 KB on this document.
	it("stays under the size budget", () => {
		expect(Buffer.byteLength(appHtml, "utf8")).toBeLessThan(400_000);
	});

	it("declares clipboard write, the one permission the pairing view needs", () => {
		const server = new McpServer({ name: "t", version: "0" });
		registerApp(server);
		const registered = (
			server as unknown as {
				_registeredResources: Record<string, { metadata?: Record<string, unknown> }>;
			}
		)._registeredResources[APP_URI];
		expect(registered?.metadata?._meta).toEqual({
			ui: { permissions: { clipboardWrite: {} } },
		});
	});
});
