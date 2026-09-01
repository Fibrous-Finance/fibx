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

function Root() {
	const [initial, setInitial] = useState<AuthStatus | null>(null);
	const [connectError, setConnectError] = useState<string | null>(null);

	useEffect(() => {
		app.addEventListener("toolresult", (result) => {
			try {
				setInitial(parseToolJson<AuthStatus>(result));
			} catch (e) {
				setConnectError(e instanceof Error ? e.message : String(e));
			}
		});

		// connect() rejects when the ui/initialize handshake fails. Keep that
		// visible: the gate that proved this pipeline relied on being able to
		// tell "never rendered" from "rendered, handshake failed".
		app.connect().catch((e: unknown) => setConnectError(`connect failed: ${String(e)}`));

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
	return <Panel app={app} initial={initial} />;
}

render(<Root />, document.getElementById("root")!);
