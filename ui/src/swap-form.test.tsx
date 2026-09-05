// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { SwapForm } from "./swap-form.js";
import { fakeApp, mount } from "./test-utils.js";
import type { QuoteResult } from "./quote.js";

const QUOTE: QuoteResult = {
	input: "0.001 ETH",
	output: "~2.45 USDC",
	rate: "1 ETH ≈ 2450 USDC",
	chain: "base",
	slippage: "0.5%",
	router: "0xr",
	quote: {
		fromToken: "ETH",
		toToken: "USDC",
		inputAmount: "0.001",
		outputAmount: "2.45",
		minReceived: "2.43",
		slippage: 0.5,
		usdIn: 2.45,
		usdOut: 2.45,
		priceImpact: 0.02,
		route: [{ protocol: 1, displayName: "Hydrex", pool: "0xp" }],
		routerAddress: "0xr",
		chain: "base",
	},
};
const TERMS = { from: "ETH", to: "USDC", amount: "0.001", slippage: 0.5 };
const SIM = {
	success: true,
	mode: "SIMULATION",
	amountIn: "0.001",
	amountOut: "2.45",
	tokenIn: "ETH",
	tokenOut: "USDC",
	chain: "base",
	requiresApproval: false,
};

function form(overrides: Partial<Parameters<typeof SwapForm>[0]> = {}, answers = {}) {
	const app = fakeApp({ get_quote: QUOTE, swap_tokens: SIM, ...answers });
	const m = mount(
		<SwapForm
			app={app}
			chain="base"
			terms={TERMS}
			quote={QUOTE}
			balances={{ ETH: "0.01" }}
			connected
			onPickToken={() => {}}
			{...overrides}
		/>
	);
	return { app, m };
}

describe("SwapForm", () => {
	it("draws the quote: amounts, rate, route", () => {
		const { m } = form();
		expect(m.text()).toContain("2.45");
		expect(m.text()).toContain("Hydrex");
		m.unmount();
	});

	it("keeps Swap disabled until a simulate succeeds", async () => {
		const { m } = form();
		expect((m.q("button[data-action=swap]") as HTMLButtonElement).disabled).toBe(true);
		m.click("button[data-action=simulate]");
		await m.flush();
		expect((m.q("button[data-action=swap]") as HTMLButtonElement).disabled).toBe(false);
		m.unmount();
	});

	// The raw eth_estimateGas dump the first real use saw. Now the form knows
	// the balance and refuses before any call is made.
	it("blocks Simulate and names the shortfall when the amount exceeds the balance", () => {
		const { m, app } = form({ balances: { ETH: "0.0002" } });
		expect((m.q("button[data-action=simulate]") as HTMLButtonElement).disabled).toBe(true);
		expect(m.text()).toContain("Insufficient balance");
		expect(m.text()).toContain("0.0002 ETH");
		expect(app.calls.filter((c) => c.name === "swap_tokens")).toHaveLength(0);
		m.unmount();
	});

	it("re-quotes when the amount changes, after a debounce, and re-locks Swap", async () => {
		vi.useFakeTimers();
		const { m, app } = form();
		m.click("button[data-action=simulate]");
		await vi.advanceTimersByTimeAsync(0);
		expect((m.q("button[data-action=swap]") as HTMLButtonElement).disabled).toBe(false);
		m.type("input[data-field=amount]", "0.002");
		expect((m.q("button[data-action=swap]") as HTMLButtonElement).disabled).toBe(true);
		expect(app.calls.filter((c) => c.name === "get_quote")).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(450);
		expect(app.calls.filter((c) => c.name === "get_quote")).toHaveLength(1);
		expect(app.calls.at(-1)?.args.amount).toBe("0.002");
		vi.useRealTimers();
		m.unmount();
	});

	it("never calls swap_tokens on its own", async () => {
		vi.useFakeTimers();
		const { m, app } = form();
		m.type("input[data-field=amount]", "0.003");
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.calls.filter((c) => c.name === "swap_tokens")).toHaveLength(0);
		vi.useRealTimers();
		m.unmount();
	});

	// The duplicate-swap hole, now under test rather than hand verification.
	it("locks every control once a broadcast never resolves", async () => {
		vi.useFakeTimers();
		const { m } = form(
			{},
			{
				swap_tokens: (args: Record<string, unknown>) =>
					args.simulate
						? SIM
						: {
								txHash: "0xh",
								amountIn: "0.001",
								amountOut: "2.45",
								tokenIn: "ETH",
								tokenOut: "USDC",
								chain: "base",
							},
				get_tx_status: new Error("receipt not found"),
			}
		);
		m.click("button[data-action=simulate]");
		await vi.advanceTimersByTimeAsync(0);
		m.click("button[data-action=swap]");
		await vi.advanceTimersByTimeAsync(0);
		// Past MAX_POLL_ATTEMPTS seconds of "not mined yet".
		await vi.advanceTimersByTimeAsync(125_000);
		expect(m.text()).toContain("0xh");
		for (const sel of [
			"button[data-action=swap]",
			"button[data-action=simulate]",
			"input[data-field=amount]",
			"input[data-field=slippage]",
		]) {
			expect((m.q(sel) as HTMLButtonElement).disabled).toBe(true);
		}
		vi.useRealTimers();
		m.unmount();
	});

	it("explains a simulate failure in the user's language", async () => {
		const { m } = form(
			{},
			{ swap_tokens: new Error("UserRejectedRequestError: User rejected the request") }
		);
		m.click("button[data-action=simulate]");
		await m.flush();
		expect(m.text()).toContain("Rejected in your wallet");
		expect(m.text()).not.toContain("UserRejectedRequestError");
		m.unmount();
	});
});
