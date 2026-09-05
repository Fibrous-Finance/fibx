import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { App } from "@modelcontextprotocol/ext-apps";
import { FibxApp } from "./app.js";
import { parseToolJson } from "./status.js";
import type { Snapshot } from "./types.js";
import "./tokens.css";

const app = new App({ name: "FibX", version: "1.0.0" });

if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
	document.documentElement.classList.add("dark");
}

/**
 * withErrorHandling (src/mcp/tools/error-handling.ts) returns a failure as an
 * ordinary result with `{ success: false, error }` and no `isError`, so the
 * host still renders this document. Nothing here is actionable then.
 */
function toolError(payload: unknown): string | null {
	if (payload === null || typeof payload !== "object") return null;
	const body = payload as { success?: unknown; error?: unknown };
	if (body.success !== false) return null;
	return typeof body.error === "string" && body.error !== ""
		? body.error
		: "The tool call failed.";
}

function Root() {
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
	const [failure, setFailure] = useState<string | null>(null);

	useEffect(() => {
		app.addEventListener("toolresult", (result) => {
			try {
				const parsed = parseToolJson<Snapshot>(result);
				const f = toolError(parsed);
				if (f) {
					setFailure(f);
					return;
				}
				setSnapshot(parsed);
			} catch (e) {
				setFailure(e instanceof Error ? e.message : String(e));
			}
		});
		app.connect().catch((e: unknown) => setFailure(`connect failed: ${String(e)}`));
		return () => {
			app.close().catch(() => {});
		};
	}, []);

	if (failure) {
		return (
			<div data-fibx-app class="app">
				<span class="brand">FibX</span>
				<p class="error">{failure}</p>
			</div>
		);
	}
	if (!snapshot) {
		return (
			<div data-fibx-app class="app">
				<span class="brand">FibX</span>
				<p class="muted">opening…</p>
			</div>
		);
	}
	return <FibxApp app={app} snapshot={snapshot} />;
}

render(<Root />, document.getElementById("root")!);
