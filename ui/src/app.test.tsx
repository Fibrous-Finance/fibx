// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { FibxApp } from "./app.js";
import { fakeApp, mount } from "./test-utils.js";
import type { Snapshot } from "./types.js";

const BASE: Snapshot = {
	chain: "base",
	auth: {
		authenticated: false,
		walletAddress: null,
		sessionType: null,
		chain: "base",
		requiresApprovalPerTransaction: false,
		fibrousStatus: "ok",
	},
	balances: null,
	policy: { state: "absent", path: "/p", message: "No signing policy is set." },
	terms: null,
	quote: null,
	quoteError: null,
};

describe("FibxApp", () => {
	it("renders the whole app from a bare snapshot: header, form, policy", () => {
		const m = mount(<FibxApp app={fakeApp({})} snapshot={BASE} />);
		expect(m.container.querySelector("[data-fibx-app]")).not.toBeNull();
		expect(m.text()).toContain("Connect");
		expect(m.container.querySelector("input[data-field=amount]")).not.toBeNull();
		expect(m.text()).toContain("Signing policy");
		m.unmount();
	});

	it("shows the address when connected", () => {
		const snap = {
			...BASE,
			auth: {
				...BASE.auth,
				authenticated: true,
				walletAddress: "0x0363000000000000000000000000000000003d44",
				sessionType: "walletconnect" as const,
			},
			balances: { ETH: "0.0002" },
		};
		const m = mount(<FibxApp app={fakeApp({})} snapshot={snap} />);
		expect(m.text()).toContain("0x0363…3d44");
		m.unmount();
	});

	it("pre-fills the form from terms and shows a pre-fetched quote error in place", () => {
		const snap = {
			...BASE,
			terms: { from: "XYZ", to: "USDC", amount: "1", slippage: 0.5 },
			quoteError: "Token not found: XYZ",
		};
		const m = mount(<FibxApp app={fakeApp({})} snapshot={snap} />);
		expect((m.q("input[data-field=amount]") as HTMLInputElement).value).toBe("1");
		expect(m.text()).toContain("XYZ");
		expect(m.text()).toContain("not on this chain");
		m.unmount();
	});

	it("opens the picker from a token button and closes it on pick", async () => {
		const tokens = {
			chain: "base",
			tokens: [
				{ symbol: "USDC", name: "USD Coin", address: "0x2", decimals: 6 },
				{ symbol: "DAI", name: "Dai", address: "0x3", decimals: 18 },
			],
		};
		const m = mount(<FibxApp app={fakeApp({ list_tokens: tokens })} snapshot={BASE} />);
		m.click("button[data-action=pick-from]");
		await m.flush();
		expect(m.container.querySelector(".picker")).not.toBeNull();
		// terms.to is USDC (the default), so the from picker excludes USDC.
		expect(m.container.querySelector('[data-token="USDC"]')).toBeNull();
		m.click('[data-token="DAI"]');
		await m.flush();
		expect(m.container.querySelector(".picker")).toBeNull();
		m.unmount();
	});

	it("flags a private key session as bounded by policy only", () => {
		const snap = {
			...BASE,
			auth: {
				...BASE.auth,
				authenticated: true,
				walletAddress: "0x0363000000000000000000000000000000003d44",
				sessionType: "private-key" as const,
			},
		};
		const m = mount(<FibxApp app={fakeApp({})} snapshot={snap} />);
		expect(m.text()).toContain("bounded by policy only");
		m.unmount();
	});

	it("flags a WalletConnect session as approving on the phone, not bounded by policy alone", () => {
		const snap = {
			...BASE,
			auth: {
				...BASE.auth,
				authenticated: true,
				walletAddress: "0x0363000000000000000000000000000000003d44",
				sessionType: "walletconnect" as const,
			},
		};
		const m = mount(<FibxApp app={fakeApp({})} snapshot={snap} />);
		expect(m.text()).toContain("approves on your phone");
		expect(m.text()).not.toContain("bounded by policy only");
		m.unmount();
	});

	// `logout` deletes session.json — on the imported-key path that file is the
	// encrypted private key. One click on the address must not do that.
	it("asks before ending the session, and only ends it on the second click", async () => {
		const snap = {
			...BASE,
			auth: {
				...BASE.auth,
				authenticated: true,
				walletAddress: "0x0363000000000000000000000000000000003d44",
				sessionType: "walletconnect" as const,
			},
		};
		const app = fakeApp({
			logout: { ok: true },
			get_auth_status: BASE.auth,
		});
		const m = mount(<FibxApp app={app} snapshot={snap} />);
		m.click("button[data-action=wallet]");
		await m.flush();
		expect(m.container.querySelector("button[data-action=end-session]")).not.toBeNull();
		expect(m.container.querySelector("button[data-action=keep-session]")).not.toBeNull();
		expect(app.calls.filter((c) => c.name === "logout")).toHaveLength(0);
		m.click("button[data-action=end-session]");
		await m.flush();
		expect(app.calls.filter((c) => c.name === "logout")).toHaveLength(1);
		m.unmount();
	});

	it("switches to the pairing view from Connect and back on cancel", async () => {
		const m = mount(<FibxApp app={fakeApp({})} snapshot={BASE} />);
		m.click("button[data-action=wallet]");
		await m.flush();
		expect(m.container.querySelector("button[data-action=connect]")).not.toBeNull();
		m.click("button[data-action=back]");
		await m.flush();
		expect(m.container.querySelector("input[data-field=amount]")).not.toBeNull();
		m.unmount();
	});
});
