import { describe, expect, it } from "vitest";
import { ErrorCode } from "../../lib/errors.js";
import { renderQrTerminal, renderQrDataUri } from "./qr.js";

const URI = "wc:abc123@2?relay-protocol=irn&symKey=deadbeef";

describe("qr rendering", () => {
	it("renders a non-empty block for the terminal", async () => {
		const out = await renderQrTerminal(URI);
		expect(out.length).toBeGreaterThan(0);
		expect(out).toMatch(/\n/); // more than one row
	});

	it("renders a png data uri", async () => {
		const out = await renderQrDataUri(URI);
		expect(out.startsWith("data:image/png;base64,")).toBe(true);
	});

	// Typed, like every other failure in this tree: a bare Error falls through
	// to UNKNOWN_ERROR in both the CLI formatter and the MCP error handler.
	it("rejects an empty payload rather than emitting a blank code", async () => {
		await expect(renderQrTerminal("")).rejects.toMatchObject({
			code: ErrorCode.VALIDATION_ERROR,
		});
		await expect(renderQrDataUri("")).rejects.toMatchObject({
			code: ErrorCode.VALIDATION_ERROR,
		});
	});
});
