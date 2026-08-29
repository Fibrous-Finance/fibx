import { describe, expect, it } from "vitest";
import { routeChoice } from "./setup.js";

describe("routeChoice", () => {
	it("routes a wallet the user already has to WalletConnect", () => {
		expect(routeChoice("1")).toBe("connect");
	});

	it("routes an unattended wallet to Privy", () => {
		expect(routeChoice("2")).toBe("privy");
	});

	it("routes a private key to import", () => {
		expect(routeChoice("3")).toBe("import");
	});

	// The combination the research found unavailable. It gets an explanation
	// rather than a path, which is the honest answer.
	it("routes the unavailable combination to an explanation", () => {
		expect(routeChoice("?")).toBe("explain");
	});

	it("treats anything else as the explanation too, rather than guessing", () => {
		expect(routeChoice("")).toBe("explain");
		expect(routeChoice("4")).toBe("explain");
	});
});
