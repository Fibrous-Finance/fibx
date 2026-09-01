import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { App } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "FibX Wallet", version: "1.0.0" });

function Panel() {
	const [status, setStatus] = useState<string>("waiting for the host…");

	useEffect(() => {
		// ontoolresult is deprecated in ext-apps@1.7.5 in favor of
		// addEventListener, which composes with other listeners.
		app.addEventListener("toolresult", (result) => {
			const text = result.content?.find((c) => c.type === "text")?.text;
			setStatus(text ?? "[no result]");
		});

		// connect() rejects when the ui/initialize handshake fails, closing the
		// transport and rethrowing. Left as a floating promise, that rejection
		// lands in a sandboxed iframe console nobody reads, and this panel's
		// only job — Task 1's manual gate — is to tell apart "never rendered",
		// "rendered but the handshake failed" and "connected, no result yet".
		app.connect()
			.then(() => setStatus("connected — waiting for a tool result"))
			.catch((error: unknown) => setStatus(`connect failed: ${String(error)}`));

		return () => {
			app.close().catch(() => {});
		};
	}, []);

	return (
		<div data-fibx-panel>
			<h1>FibX Wallet</h1>
			<pre>{status}</pre>
		</div>
	);
}

render(<Panel />, document.getElementById("root")!);
