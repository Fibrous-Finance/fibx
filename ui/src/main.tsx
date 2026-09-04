import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { App } from "@modelcontextprotocol/ext-apps";
import { Panel, type AuthStatus } from "./panel.js";
import { SwapCard } from "./swap-card.js";
import { parseToolJson } from "./status.js";
import type { QuoteResult } from "./quote.js";
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
 * Fallback for a host that does not populate toolInfo. get_quote's every
 * branch — a routed swap and the wrap/unwrap 1:1 conversions
 * (src/mcp/handlers/quote.ts) — shares this envelope, and no other fibx tool
 * result does: `quote` alone would under-cover wrap/unwrap, which return no
 * route to nest one under. These four keys together are what every
 * get_quote response carries, and only a get_quote response, so the
 * payload's own shape is enough to decide with no host-API assumption at
 * all. (Verified against every other handler's jsonResult call in this repo
 * — none combines all four.)
 */
function surfaceFromPayload(payload: unknown): Surface {
	if (payload === null || typeof payload !== "object") return "panel";
	return "input" in payload && "output" in payload && "rate" in payload && "chain" in payload
		? "swap-card"
		: "panel";
}

function Root() {
	const [surface, setSurface] = useState<Surface | null>(null);
	const [initial, setInitial] = useState<Record<string, unknown> | null>(null);
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
				setInitial(parsed);
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

	// Each surface owns its own interpretation of the same untyped payload —
	// the panel expects an AuthStatus-shaped push (get_auth_status, connect_
	// wallet, …), the card expects a get_quote result. surfaceFromToolName /
	// surfaceFromPayload above are what keep the two from ever crossing.
	if (surface === "swap-card") {
		return <SwapCard app={app} initial={initial as QuoteResult | null} />;
	}

	return <Panel app={app} initial={initial as AuthStatus | null} />;
}

render(<Root />, document.getElementById("root")!);
