// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { TokenPicker } from "./picker.js";
import { fakeApp, mount } from "./test-utils.js";

const TOKENS = {
	chain: "base",
	tokens: [
		{ symbol: "ZRO", name: "LayerZero", address: "0x1", decimals: 18 },
		{ symbol: "USDC", name: "USD Coin", address: "0x2", decimals: 6 },
		{ symbol: "ETH", name: "Ether", address: "0x3", decimals: 18 },
	],
};

describe("TokenPicker", () => {
	it("lists the chain's tokens, popular first, after list_tokens answers", async () => {
		const app = fakeApp({ list_tokens: TOKENS });
		const m = mount(
			<TokenPicker app={app} chain="base" onPick={() => {}} onClose={() => {}} />
		);
		await m.flush();
		const symbols = [...m.container.querySelectorAll("[data-token]")].map((el) =>
			el.getAttribute("data-token")
		);
		expect(symbols).toEqual(["ETH", "USDC", "ZRO"]);
		expect(app.calls[0]).toEqual({ name: "list_tokens", args: { chain: "base" } });
		m.unmount();
	});

	it("filters as the user types", async () => {
		const m = mount(
			<TokenPicker
				app={fakeApp({ list_tokens: TOKENS })}
				chain="base"
				onPick={() => {}}
				onClose={() => {}}
			/>
		);
		await m.flush();
		m.type("input[type=search]", "layer");
		await m.flush();
		expect(m.container.querySelectorAll("[data-token]")).toHaveLength(1);
		expect(m.q("[data-token]").getAttribute("data-token")).toBe("ZRO");
		m.unmount();
	});

	it("reports the picked token and does not list the excluded one", async () => {
		const onPick = vi.fn();
		const m = mount(
			<TokenPicker
				app={fakeApp({ list_tokens: TOKENS })}
				chain="base"
				exclude="ETH"
				onPick={onPick}
				onClose={() => {}}
			/>
		);
		await m.flush();
		expect(m.container.querySelector('[data-token="ETH"]')).toBeNull();
		m.click('[data-token="USDC"]');
		expect(onPick).toHaveBeenCalledWith(TOKENS.tokens[1]);
		m.unmount();
	});

	// The list failing is a message in the picker, not a crash of the app.
	it("explains a failed list instead of an empty box", async () => {
		const m = mount(
			<TokenPicker
				app={fakeApp({ list_tokens: new Error("Network error") })}
				chain="base"
				onPick={() => {}}
				onClose={() => {}}
			/>
		);
		await m.flush();
		expect(m.text()).toContain("Network error");
		m.unmount();
	});
});
