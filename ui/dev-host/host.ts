import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

const iframe = document.getElementById("widget") as HTMLIFrameElement;
const modelOut = document.getElementById("model")!;
const callsOut = document.getElementById("calls")!;

async function fixture(name: string): Promise<unknown> {
	const r = await fetch(`./fixtures/${name}.json`);
	return r.json();
}

// $ref: "file.json" or "file.json#/path/to/key". Fixtures only; not a library.
async function resolveRefs(v: unknown): Promise<unknown> {
	if (Array.isArray(v)) return Promise.all(v.map(resolveRefs));
	if (v === null || typeof v !== "object") return v;
	const o = v as Record<string, unknown>;
	if (typeof o.$ref === "string") {
		const [file, pointer = ""] = o.$ref.split("#");
		let target = await resolveRefs(await fixture(file.replace(/\.json$/, "")));
		for (const key of pointer.split("/").filter(Boolean)) {
			target = (target as Record<string, unknown>)[key];
		}
		return target;
	}
	const out: Record<string, unknown> = {};
	for (const [k, val] of Object.entries(o)) out[k] = await resolveRefs(val);
	return out;
}

function radio(name: string): string {
	return (document.querySelector(`input[name=${name}]:checked`) as HTMLInputElement).value;
}

function wrap(entry: unknown): { content: [{ type: "text"; text: string }] } {
	return { content: [{ type: "text", text: JSON.stringify(entry) }] };
}

let sequence = new Map<string, number>();

/** entry[i], clamped to the last element once the sequence runs out. */
function pick(entry: unknown, i: number): unknown {
	if (!Array.isArray(entry)) return entry;
	return entry[Math.min(i, entry.length - 1)];
}

async function answer(name: string, args: Record<string, unknown>): Promise<unknown> {
	const mode = (document.getElementById("mode") as HTMLSelectElement).value;
	if (mode === "live") {
		const r = await fetch("http://localhost:7331/call", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name, arguments: args }),
		});
		return r.json(); // the CallToolResult, verbatim
	}
	const table = (await resolveRefs(await fixture("tools"))) as Record<string, unknown>;
	const outcome = radio("outcome");
	const i = sequence.get(name) ?? 0;
	sequence.set(name, i + 1);

	// outcome overrides for swap_tokens / get_tx_status per the fixture notes.
	// A checked-in `entry` below is always the un-picked source; `pick` only
	// runs against it once, right before returning.
	if (name === "swap_tokens" && outcome === "insufficient" && i === 0) {
		// Only the *simulate* call (the first one) fails this way — the form
		// never reaches a second swap_tokens call once simulate has failed.
		return wrap(table.swap_tokens_insufficient_simulate);
	}
	if (name === "get_tx_status" && outcome === "reverted") {
		return wrap(pick(table.get_tx_status_reverted, i));
	}
	if (name === "get_tx_status" && outcome === "unknown") {
		// Never resolve: hold on the first (pending) entry forever so the
		// widget's own poll loop is what eventually gives up.
		return wrap(pick(table.get_tx_status, 0));
	}
	return wrap(pick(table[name], i));
}

// The previous bridge, so a "Reload widget" click can close it before opening
// a new one. `iframe.contentWindow` is the same WindowProxy across every
// navigation of this one <iframe> element — it does not change identity the
// way `contentDocument` does — so PostMessageTransport's source check can
// never tell an old listener apart from the current one. Without closing the
// old bridge first, every past boot()'s handlers keep firing on every new
// message, and each observed effect (a model-context line, a logged call)
// multiplies once per past reload.
let currentBridge: AppBridge | null = null;

async function boot() {
	sequence = new Map();
	callsOut.textContent = "";
	modelOut.textContent = "";

	if (currentBridge) {
		await currentBridge.close().catch(() => {});
		currentBridge = null;
	}

	// The clipboard-write permission is enforced by the iframe's `allow`
	// attribute at the browser level, separate from what the bridge declares
	// in its sandbox capability below — both must agree, or the Copy button
	// vanishes into its refused sentence despite the bridge granting it.
	const grantClipboard = (document.getElementById("clipboard") as HTMLInputElement).checked;
	if (grantClipboard) iframe.allow = "clipboard-write";
	else iframe.removeAttribute("allow");

	iframe.src = "/dist/index.html?" + Date.now();
	await new Promise((r) => (iframe.onload = r));

	const bridge = new AppBridge(
		null,
		{ name: "fibx-dev-host", version: "0" },
		{
			serverTools: {},
			openLinks: {},
			updateModelContext: {},
			sandbox: { permissions: grantClipboard ? { clipboardWrite: {} } : {} },
		},
		{
			hostContext: {
				toolInfo: { tool: { name: "open_fibx", inputSchema: { type: "object" } } },
				theme: "dark",
			},
		}
	);

	bridge.oncalltool = async (params) => {
		callsOut.textContent += `${params.name} ${JSON.stringify(params.arguments ?? {})}\n`;
		return (await answer(params.name, params.arguments ?? {})) as never;
	};
	bridge.onopenlink = async ({ url }) => {
		const ok =
			url.startsWith("http") ||
			(document.getElementById("wclinks") as HTMLInputElement).checked;
		callsOut.textContent += `openLink ${url} → ${ok ? "ok" : "refused"}\n`;
		return ok ? {} : { isError: true };
	};
	bridge.onupdatemodelcontext = async (params) => {
		modelOut.textContent +=
			(params.content ?? []).map((c) => ("text" in c ? c.text : "")).join("\n") + "\n\n";
		return {};
	};
	bridge.oninitialized = async () => {
		const snap = await resolveRefs(await fixture(radio("fixture")));
		await bridge.sendToolResult({ content: [{ type: "text", text: JSON.stringify(snap) }] });
	};

	await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
	currentBridge = bridge;
}

document.getElementById("reload")!.addEventListener("click", () => void boot());
void boot();
