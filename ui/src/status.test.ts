import { describe, expect, it } from "vitest";
import { describeSession, nextPoll, parseToolJson, shortAddress } from "./status.js";

describe("nextPoll", () => {
	it("keeps polling while the pairing is pending", () => {
		expect(nextPoll({ status: "pending" }, 3)).toEqual({ action: "poll", attempt: 4 });
	});

	it("stops as soon as the wallet connects", () => {
		expect(nextPoll({ status: "connected" }, 3).action).toBe("stop");
	});

	it("stops on failure rather than polling a dead pairing", () => {
		expect(nextPoll({ status: "failed" }, 3).action).toBe("stop");
	});

	// A pairing the server no longer knows about will not become connected by
	// being asked again.
	it("stops on unknown", () => {
		expect(nextPoll({ status: "unknown" }, 3).action).toBe("stop");
	});

	// Without a ceiling a forgotten tab polls the server forever.
	it("gives up after the attempt ceiling", () => {
		expect(nextPoll({ status: "pending" }, 120).action).toBe("expired");
	});
});

describe("parseToolJson", () => {
	// Every fibx tool answers with one text content block holding JSON; this is
	// the one place that shape is decoded, so a host that adds blocks or a tool
	// that answers with prose fails here, loudly, instead of as `undefined`
	// deep inside a render.
	it("decodes the first text block", () => {
		const out = parseToolJson<{ ok: boolean }>({
			content: [{ type: "text", text: '{"ok":true}' }],
		});
		expect(out).toEqual({ ok: true });
	});

	it("throws on a result with no text block", () => {
		expect(() => parseToolJson({ content: [] })).toThrow(/no text/i);
	});

	it("throws on a text block that is not JSON", () => {
		expect(() => parseToolJson({ content: [{ type: "text", text: "nope" }] })).toThrow();
	});
});

describe("shortAddress", () => {
	it("keeps the first six and last four characters", () => {
		expect(shortAddress("0x036395BBb9a85B8E285a1323e46650738d543d44")).toBe("0x0363…3d44");
	});
});

describe("describeSession", () => {
	it("says a WalletConnect session approves on the phone", () => {
		const d = describeSession("walletconnect");
		expect(d.approvesPerTransaction).toBe(true);
		expect(d.policyIsOnlyBound).toBe(false);
	});

	it("says a Privy session runs unattended behind a server policy", () => {
		const d = describeSession("privy");
		expect(d.approvesPerTransaction).toBe(false);
		expect(d.policyIsOnlyBound).toBe(false);
	});

	// The path with no other bound. Worth saying out loud, since it is the one
	// where the local policy is the only thing between an agent and the key.
	it("flags the imported key as bounded by the local policy alone", () => {
		const d = describeSession("private-key");
		expect(d.approvesPerTransaction).toBe(false);
		expect(d.policyIsOnlyBound).toBe(true);
	});
});
