import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { App } from "@modelcontextprotocol/ext-apps";
import { Panel, type AuthStatus } from "./panel.js";
import { parseToolJson } from "./status.js";
import "./tokens.css";

const app = new App({ name: "FibX Wallet", version: "1.0.0" });

if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
	document.documentElement.classList.add("dark");
}

// This is the ONE document built by ui/vite.config.ts, registered under two
// ui:// URIs in src/mcp/ui.ts (WALLET_PANEL_URI and SWAP_CARD_URI) because a
// second independent entry would duplicate the SDK's schema layer rather
// than share it — see the comment in src/mcp/ui.ts. So the document itself
// has to decide which surface to render.
type Surface = "panel" | "swap-card";

/**
 * The tool that instantiated this App instance is reachable via
 * `app.getHostContext()?.toolInfo?.tool?.name`, populated from the
 * `ui/initialize` handshake result (verified against the installed
 * @modelcontextprotocol/ext-apps package — App.getHostContext() is a public,
 * documented accessor, not a guess). This is available as soon as connect()
 * resolves, before any toolresult notification arrives, so prefer it.
 */
function surfaceFromToolName(name: string | undefined): Surface | undefined {
	return name === "get_quote" ? "swap-card" : undefined;
}

/**
 * Fallback for a host that does not populate toolInfo. A get_quote result
 * nests everything a card needs under a `quote` key (src/mcp/handlers/
 * quote.ts) — no other fibx tool result carries that key — so the payload's
 * own shape is enough to decide, with no host-API assumption at all.
 */
function surfaceFromPayload(payload: unknown): Surface {
	return payload !== null && typeof payload === "object" && "quote" in payload
		? "swap-card"
		: "panel";
}

// Task 6 replaces this stub with the real card; this task delivers the
// switch that reaches it. data-fibx-swap-card must survive onto the card's
// own root element — it is the marker src/mcp/ui.test.ts recognises.
function SwapCard() {
	return <div data-fibx-swap-card>FibX Swap</div>;
}

function Root() {
	const [surface, setSurface] = useState<Surface | null>(null);
	const [initial, setInitial] = useState<AuthStatus | null>(null);
	const [connectError, setConnectError] = useState<string | null>(null);

	useEffect(() => {
		// toolInfo (checked in both places below) is only populated once
		// connect() resolves the ui/initialize handshake, but a host may
		// dispatch the toolresult notification before or after that handshake
		// finishes — so both the handler and the connect() continuation check
		// it, and whichever fires with a name wins over the payload fallback.
		app.addEventListener("toolresult", (result) => {
			try {
				const parsed = parseToolJson<Record<string, unknown>>(result);
				const fromHost = surfaceFromToolName(app.getHostContext()?.toolInfo?.tool?.name);
				setSurface(fromHost ?? surfaceFromPayload(parsed));
				setInitial(parsed as AuthStatus);
			} catch (e) {
				setConnectError(e instanceof Error ? e.message : String(e));
			}
		});

		// connect() rejects when the ui/initialize handshake fails. Keep that
		// visible: the gate that proved this pipeline relied on being able to
		// tell "never rendered" from "rendered, handshake failed".
		app.connect()
			.then(() => {
				const fromHost = surfaceFromToolName(app.getHostContext()?.toolInfo?.tool?.name);
				// Only the host-context signal is available here — no
				// toolresult payload has necessarily arrived yet. Don't guess
				// "panel" from its absence; wait for the payload fallback.
				if (fromHost) setSurface(fromHost);
			})
			.catch((e: unknown) => setConnectError(`connect failed: ${String(e)}`));

		return () => {
			app.close().catch(() => {});
		};
	}, []);

	if (connectError) {
		return (
			<div data-fibx-panel>
				<h1>FibX Wallet</h1>
				<p class="error">{connectError}</p>
			</div>
		);
	}

	if (surface === "swap-card") return <SwapCard />;

	return <Panel app={app} initial={initial} />;
}

render(<Root />, document.getElementById("root")!);
