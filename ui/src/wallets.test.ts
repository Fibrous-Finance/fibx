import { describe, expect, it } from "vitest";
import { walletLink } from "./wallets.js";

const URI = "wc:abc@2?relay-protocol=irn&symKey=deadbeef";

describe("walletLink", () => {
	// The three brand links were mobile universal links. openLink opens the
	// host's default browser, not an app, so on a desktop they resolved to a
	// "open this in your app" web page and reported success. A bare wc: URI is
	// what desktop wallets register as a protocol handler.
	it("hands over the pairing URI unchanged", () => {
		expect(walletLink(URI)).toBe(URI);
	});

	// Encoding it would break the scheme the OS dispatches on.
	it("does not percent-encode the scheme", () => {
		expect(walletLink(URI).startsWith("wc:")).toBe(true);
	});
});
