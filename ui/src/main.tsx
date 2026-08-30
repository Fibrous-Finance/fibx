import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { App } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "FibX Wallet", version: "1.0.0" });

function Panel() {
	const [status, setStatus] = useState<string>("waiting for the host…");

	useEffect(() => {
		app.ontoolresult = (result) => {
			const text = result.content?.find((c) => c.type === "text")?.text;
			setStatus(text ?? "[no result]");
		};
		app.connect();
	}, []);

	return (
		<div data-fibx-panel>
			<h1>FibX Wallet</h1>
			<pre>{status}</pre>
		</div>
	);
}

render(<Panel />, document.getElementById("root")!);
