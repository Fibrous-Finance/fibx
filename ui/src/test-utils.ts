import { render, type ComponentChild } from "preact";

/**
 * Mount a vnode into a detached container under happy-dom and hand back the
 * few things a component test needs. No testing library: a query selector
 * and a dispatched event are enough to prove a button locks or a control
 * turns into its explanation.
 */
export function mount(vnode: ComponentChild) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	render(vnode, container);

	const q = <T extends Element = HTMLElement>(selector: string): T => {
		const el = container.querySelector<T>(selector);
		if (!el) throw new Error(`no element matches ${selector}`);
		return el;
	};

	return {
		container,
		q,
		text: () => container.textContent ?? "",
		click(selector: string) {
			q<HTMLElement>(selector).click();
		},
		type(selector: string, value: string) {
			const el = q<HTMLInputElement>(selector);
			el.value = value;
			el.dispatchEvent(new Event("input", { bubbles: true }));
		},
		async flush() {
			// Let effects and resolved promises settle.
			await new Promise((r) => setTimeout(r, 0));
			await new Promise((r) => setTimeout(r, 0));
		},
		unmount() {
			render(null, container);
			container.remove();
		},
	};
}

/** A fake `App` whose callServerTool answers from a table, and records calls. */
export function fakeApp(
	answers: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>
) {
	const calls: { name: string; args: Record<string, unknown> }[] = [];
	const app = {
		calls,
		async callServerTool({
			name,
			arguments: args = {},
		}: {
			name: string;
			arguments?: Record<string, unknown>;
		}) {
			calls.push({ name, args });
			const a = answers[name];
			if (a === undefined) throw new Error(`fakeApp: no answer for ${name}`);
			const body =
				typeof a === "function" ? (a as (x: Record<string, unknown>) => unknown)(args) : a;
			if (body instanceof Error) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ success: false, error: body.message }),
						},
					],
				};
			}
			return { content: [{ type: "text", text: JSON.stringify(body) }] };
		},
		async updateModelContext() {
			return {};
		},
		async openLink() {
			return {};
		},
		getHostContext() {
			return undefined;
		},
	};
	return app as unknown as import("@modelcontextprotocol/ext-apps").App & { calls: typeof calls };
}
