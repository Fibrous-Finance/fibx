// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, Pairing } from "./pairing.js";
import { fakeApp, mount } from "./test-utils.js";

const PAIRING = {
	uri: "wc:abc@2?relay-protocol=irn&symKey=1",
	qrDataUri: "data:image/png;base64,x",
	pairingId: "p1",
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("copyText", () => {
	it("uses the async clipboard when the host allows it", async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		expect(await copyText("wc:x")).toBe("clipboard");
		expect(writeText).toHaveBeenCalledWith("wc:x");
	});

	// The legacy path usually survives a sandbox that blocks the modern one.
	it("falls back to execCommand when the clipboard rejects", async () => {
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: async () => Promise.reject(new Error("denied")) },
			configurable: true,
		});
		document.execCommand = vi.fn(() => true);
		expect(await copyText("wc:x")).toBe("execCommand");
	});

	it("reports unavailable when both paths fail", async () => {
		Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
		document.execCommand = vi.fn(() => false);
		expect(await copyText("wc:x")).toBe("unavailable");
	});
});

describe("Pairing", () => {
	it("opens a pairing on Connect and shows the QR and the URI", async () => {
		const app = fakeApp({ connect_wallet: PAIRING, get_connect_status: { status: "pending" } });
		const m = mount(<Pairing app={app} onConnected={async () => {}} onCancel={() => {}} />);
		m.click("button[data-action=connect]");
		await m.flush();
		expect(m.q("img.qr").getAttribute("src")).toBe(PAIRING.qrDataUri);
		expect((m.q("textarea.uri") as HTMLTextAreaElement).value).toBe(PAIRING.uri);
		m.unmount();
	});

	// The bug this replaces: the button disappeared and the user read it as
	// broken. Now the control turns into the reason, in the same place.
	it("turns Copy into an explanation when the clipboard is unavailable", async () => {
		Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
		document.execCommand = vi.fn(() => false);
		const app = fakeApp({ connect_wallet: PAIRING, get_connect_status: { status: "pending" } });
		const m = mount(<Pairing app={app} onConnected={async () => {}} onCancel={() => {}} />);
		m.click("button[data-action=connect]");
		await m.flush();
		m.click("button[data-action=copy]");
		await m.flush();
		expect(m.container.querySelector("button[data-action=copy]")).toBeNull();
		expect(m.text()).toContain("Clipboard unavailable");
		m.unmount();
	});

	it("turns Open-in-wallet into an explanation when the host refuses the wc: link", async () => {
		const app = fakeApp({ connect_wallet: PAIRING, get_connect_status: { status: "pending" } });
		(app as unknown as { openLink: () => Promise<unknown> }).openLink = async () => ({
			isError: true,
		});
		const m = mount(<Pairing app={app} onConnected={async () => {}} onCancel={() => {}} />);
		m.click("button[data-action=connect]");
		await m.flush();
		m.click("button[data-action=open-wallet]");
		await m.flush();
		expect(m.container.querySelector("button[data-action=open-wallet]")).toBeNull();
		expect(m.text()).toContain("can't open wallet links");
		m.unmount();
	});

	it("calls onConnected once the pairing reports connected", async () => {
		vi.useFakeTimers();
		const onConnected = vi.fn(async () => {});
		const app = fakeApp({
			connect_wallet: PAIRING,
			get_connect_status: { status: "connected", address: "0x1" },
		});
		const m = mount(<Pairing app={app} onConnected={onConnected} onCancel={() => {}} />);
		m.click("button[data-action=connect]");
		await vi.advanceTimersByTimeAsync(1100);
		expect(onConnected).toHaveBeenCalled();
		vi.useRealTimers();
		m.unmount();
	});
});
