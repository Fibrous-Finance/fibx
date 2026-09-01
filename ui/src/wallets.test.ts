import { describe, expect, it } from "vitest";
import { walletLinks } from "./wallets.js";

const URI = "wc:abc@2?relay-protocol=irn&symKey=deadbeef";

describe("walletLinks", () => {
	// Each wallet consumes the URI through its own universal link; the encoding
	// must survive the `@`, `?` and `=` inside a wc: URI or the wallet opens
	// to nothing.
	it("encodes the pairing URI once, per wallet", () => {
		const links = walletLinks(URI);
		const encoded = encodeURIComponent(URI);
		expect(links.map((l) => l.name)).toEqual(["MetaMask", "Rabby", "Rainbow"]);
		for (const l of links) expect(l.url).toContain(encoded);
	});
});
