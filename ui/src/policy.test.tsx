// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { PolicySection } from "./policy.js";
import { fakeApp, mount } from "./test-utils.js";

const ABSENT = { state: "absent" as const, path: "/p", message: "No signing policy is set." };
const ACTIVE = { state: "active" as const, rules: { maxValue: { base: "0.05" } }, path: "/p" };

describe("PolicySection", () => {
	it("starts collapsed with a one-line summary", () => {
		const m = mount(
			<PolicySection app={fakeApp({})} initial={ABSENT} sessionKind="walletconnect" />
		);
		expect(m.text()).toContain("Signing policy");
		expect(m.text()).toContain("none set");
		expect(m.container.querySelector("form")).toBeNull();
		m.unmount();
	});

	it("expands to the rules and the form", async () => {
		const m = mount(
			<PolicySection app={fakeApp({})} initial={ACTIVE} sessionKind="walletconnect" />
		);
		m.click("button[data-action=toggle-policy]");
		await m.flush();
		expect(m.text()).toContain("base.maxValue");
		expect(m.container.querySelector("form")).not.toBeNull();
		m.unmount();
	});

	// On the imported-key path the policy is the only bound on signing, so the
	// button that destroys it must not look like the one that backs out.
	it("puts danger on the button that performs the wipe, not on Keep", async () => {
		const m = mount(
			<PolicySection
				app={fakeApp({})}
				initial={ACTIVE}
				sessionKind="private-key"
				openNonce={1}
			/>
		);
		m.click("button[data-action=wipe]");
		await m.flush();
		expect(m.q("button[data-action=wipe-confirm]").className).toContain("danger");
		expect(m.q("button[data-action=wipe-keep]").className).not.toContain("danger");
		m.unmount();
	});

	it("reloads from get_policy after a write, never trusting its own write", async () => {
		const app = fakeApp({ set_policy_rule: { ok: true }, get_policy: ACTIVE });
		const m = mount(
			<PolicySection app={app} initial={ABSENT} sessionKind="walletconnect" openNonce={1} />
		);
		m.type("input[aria-label=Value]", "0.05");
		await m.flush();
		m.click("button[type=submit]");
		await m.flush();
		expect(app.calls.map((c) => c.name)).toEqual(["set_policy_rule", "get_policy"]);
		expect(m.text()).toContain("base.maxValue");
		m.unmount();
	});

	// A boolean latched: the second refusal re-rendered the same `true` and the
	// effect never ran again, so a user who had collapsed the section saw
	// nothing happen when the next swap was refused.
	it("expands on every refusal, not just the first", async () => {
		const app = fakeApp({});
		const m = mount(
			<PolicySection app={app} initial={ACTIVE} sessionKind="walletconnect" openNonce={0} />
		);
		expect(m.container.querySelector("form")).toBeNull();
		m.rerender(
			<PolicySection app={app} initial={ACTIVE} sessionKind="walletconnect" openNonce={1} />
		);
		await m.flush();
		expect(m.container.querySelector("form")).not.toBeNull();
		m.click("button[data-action=toggle-policy]");
		await m.flush();
		expect(m.container.querySelector("form")).toBeNull();
		m.rerender(
			<PolicySection app={app} initial={ACTIVE} sessionKind="walletconnect" openNonce={2} />
		);
		await m.flush();
		expect(m.container.querySelector("form")).not.toBeNull();
		m.unmount();
	});

	it("maps a POLICY_BLOCKED refusal to its title and rule-naming detail", async () => {
		const app = fakeApp({
			set_policy_rule: {
				success: false,
				error: "policy blocked",
				code: "POLICY_BLOCKED",
				details: { rule: "base.maxValue" },
			},
		});
		const m = mount(
			<PolicySection app={app} initial={ABSENT} sessionKind="walletconnect" openNonce={1} />
		);
		m.type("input[aria-label=Value]", "0.05");
		await m.flush();
		m.click("button[type=submit]");
		await m.flush();
		expect(m.text()).toContain("Blocked by your signing policy");
		expect(m.text()).toContain("The rule base.maxValue refused it. Edit it below.");
		expect(m.container.querySelector("details")).toBeNull();
		m.unmount();
	});
});
