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
		await vi.advanceTimersByTimeAsync(0);
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

	it("explains itself in place of the explorer link when the host refuses to open it", async () => {
		vi.useFakeTimers();
		const { m, app } = form(
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
				get_tx_status: {
					hash: "0xh",
					status: "confirmed",
					blockNumber: "1",
					explorer: "https://x/tx/0xh",
				},
			}
		);
		app.openLink = async () => ({ isError: true });
		m.click("button[data-action=simulate]");
		await vi.advanceTimersByTimeAsync(0);
		m.click("button[data-action=swap]");
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(1000);
		vi.useRealTimers();
		expect(m.text()).toContain("confirmed");
		const explorerButton = Array.from(m.container.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("View on explorer")
		);
		if (!explorerButton) throw new Error("no explorer button rendered");
		explorerButton.click();
		await m.flush();
		expect(
			Array.from(m.container.querySelectorAll("button")).some((b) =>
				b.textContent?.includes("View on explorer")
			)
		).toBe(false);
		expect(m.text()).toContain("can't open links");
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
		// The detail is half the sentence: the map's whole Explained reaches the
		// screen, not just its title.
		expect(m.text()).toContain("Nothing was sent.");
		expect(m.text()).not.toContain("UserRejectedRequestError");
		m.unmount();
	});

	// A refusal that does not name the rule is a refusal the user cannot act
	// on. `details.rule` survives only because the whole Explained travels.
	it("names the policy rule that refused a simulate", async () => {
		const { m } = form(
			{},
			{
				swap_tokens: {
					success: false,
					error: "Blocked",
					code: "POLICY_BLOCKED",
					details: { rule: "base.maxValue" },
				},
			}
		);
		m.click("button[data-action=simulate]");
		await m.flush();
		expect(m.text()).toContain("Blocked by your signing policy");
		expect(m.text()).toContain("base.maxValue");
		m.unmount();
	});

	// The placeholder is what a re-explained title used to produce: the symbol
	// was gone by then, and with it the branch that offers the picker.
	it("offers the picker, with the symbol, when the token is not on the chain", async () => {
		const { m } = form(
			{ terms: { from: "XYZ", to: "USDC", amount: "1", slippage: 0.5 }, balances: null },
			{
				swap_tokens: {
					success: false,
					error: "Token not supported",
					code: "TOKEN_NOT_SUPPORTED",
				},
			}
		);
		m.click("button[data-action=simulate]");
		await m.flush();
		expect(m.text()).toContain("XYZ");
		expect(m.text()).not.toContain("That token");
		const pick = Array.from(m.container.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("Choose a different token")
		);
		expect(pick).toBeDefined();
		m.unmount();
	});

	// Picking a token (or changing chain) nulls the shell's quote, and nothing
	// else asked for a new one: "You Receive" sat at — until the user retyped
	// the amount.
	it("re-quotes when the shell re-seeds the terms with no quote", async () => {
		vi.useFakeTimers();
		const app = fakeApp({ get_quote: QUOTE });
		const props = {
			app,
			chain: "base",
			quote: null,
			balances: null,
			connected: false,
			onPickToken: () => {},
		};
		const m = mount(<SwapForm {...props} terms={TERMS} />);
		m.rerender(<SwapForm {...props} terms={{ ...TERMS, to: "DAI" }} />);
		await vi.advanceTimersByTimeAsync(450);
		const quotes = app.calls.filter((c) => c.name === "get_quote");
		expect(quotes).toHaveLength(1);
		expect(quotes[0].args.to_token).toBe("DAI");
		vi.useRealTimers();
		m.unmount();
	});

	// get_balance omits an ERC-20 the wallet holds none of, so the key is
	// simply absent. Reading that as unknown sent a zero-balance token
	// straight into swap_tokens and its eth_estimateGas dump.
	it("refuses a token the balances map omits entirely, reading it as zero", () => {
		const { m, app } = form({
			// A quote is seeded, so `short` is the only thing that can be
			// disabling Simulate here.
			terms: { from: "USDC", to: "ETH", amount: "5", slippage: 0.5 },
			balances: { ETH: "1" },
		});
		expect((m.q("button[data-action=simulate]") as HTMLButtonElement).disabled).toBe(true);
		expect(m.text()).toContain("Insufficient balance");
		expect(m.text()).toContain("0 USDC");
		expect(app.calls.filter((c) => c.name === "swap_tokens")).toHaveLength(0);
		m.unmount();
	});
});
