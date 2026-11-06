import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { App } from "@modelcontextprotocol/ext-apps";
import { FibxApp } from "./app.js";
import { explainError, type Explained } from "./errors.js";
import { FibxLockup } from "./logo.js";
import { parseToolJson } from "./status.js";
import { isDark } from "./theme.js";
import type { Snapshot } from "./types.js";
import "./tokens.css";

const app = new App({ name: "FibX", version: "1.0.0" });

/**
 * `:root.dark` from the host context's theme, else from the OS. Run now, as a
 * guess before the host has answered; again once `connect` has the host's
 * initial context; and on every context change, after which getHostContext
 * already holds the merged context, so a change that leaves the theme out
 * keeps the last one.
 */
function applyTheme(): void {
	const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
	document.documentElement.classList.toggle(
		"dark",
		isDark(app.getHostContext()?.theme, prefersDark)
	);
}
applyTheme();
app.addEventListener("hostcontextchanged", applyTheme);

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
	// All three ways this can fail go through explainError, the same as every
	// failure inside the app: a raw `String(e)`, or a server's `error` string,
	// is not a sentence a user can act on, and the unmapped branch at least
	// puts the whole text behind a disclosure instead of on the page.
	const [failure, setFailure] = useState<Explained | null>(null);

	useEffect(() => {
		app.addEventListener("toolresult", (result) => {
			try {
				const parsed = parseToolJson<Snapshot>(result);
				const f = toolError(parsed);
				if (f) {
					setFailure(explainError(new Error(f), {}));
					return;
				}
				setSnapshot(parsed);
			} catch (e) {
				setFailure(explainError(e, {}));
			}
		});
		app.connect().then(applyTheme, (e: unknown) =>
			setFailure(explainError(new Error(`connect failed: ${String(e)}`), {}))
		);
		return () => {
			app.close().catch(() => {});
		};
	}, []);

	if (failure) {
		return (
			<div data-fibx-app class="app">
				<FibxLockup />
				<p class="error">{failure.title}</p>
				{failure.detail && <p class="muted">{failure.detail}</p>}
				{failure.raw && (
					<details>
						<summary>details</summary>
						<pre class="mono">{failure.raw}</pre>
					</details>
				)}
			</div>
		);
	}
	if (!snapshot) {
		return (
			<div data-fibx-app class="app">
				<FibxLockup />
				<p class="muted">opening…</p>
			</div>
		);
	}
	return <FibxApp app={app} snapshot={snapshot} />;
}

render(<Root />, document.getElementById("root")!);
