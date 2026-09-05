import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * The browser cannot spawn a stdio process, so this relay does: it runs the
 * built server, holds one MCP client to it, and answers the dev host's
 * callServerTool over plain HTTP. Dev only; not built, not published.
 *
 * It talks to the REAL server — a real session, a real policy file, real
 * quotes. A Swap from the dev host in live mode is a real swap. That is why
 * three things bound what can reach it, and none of them may be relaxed for
 * convenience:
 *
 * 1. It **listens on 127.0.0.1 only**, so nothing on the LAN can reach it.
 * 2. It **answers one exact origin** — the Vite dev server's — and refuses
 *    every other with `403` and no CORS headers, so a cross-origin `fetch`
 *    from any other page the developer happens to have open cannot preflight
 *    its way in.
 * 3. It **relays only the tools the app itself calls** (RELAYABLE below) and
 *    refuses anything else with `403`. `send_tokens` and `aave_action` are
 *    deliberately absent: nothing in `ui/src` calls them, and an unattended
 *    signing path must not be reachable through a dev convenience.
 *
 * The root tsconfig's `rootDir` is `"."` (not `"src"`) so this file
 * typechecks alongside `src/`; every `tsc` script in this repo is
 * `--noEmit`, and tsup — not `tsc` — owns emission for the published build.
 */
const PORT = 7331;

/** The Vite dev server (`ui/dev-host/vite.config.ts` leaves the port at its default). */
const ALLOWED_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);

/**
 * Every tool name `ui/src` passes to `callJson`, and nothing else. Adding a
 * name here makes it callable over HTTP against the real wallet — do it only
 * when the app itself starts calling it.
 */
const RELAYABLE = new Set([
	"get_quote",
	"list_tokens",
	"swap_tokens",
	"get_tx_status",
	"get_auth_status",
	"get_balance",
	"get_policy",
	"connect_wallet",
	"get_connect_status",
	"logout",
	"set_policy_rule",
	"clear_policy_rule",
]);

const transport = new StdioClientTransport({
	command: "node",
	args: ["dist/index.js", "mcp-start"],
});
const client = new Client({ name: "fibx-dev-host-bridge", version: "0" });
await client.connect(transport);

async function shutdown(signal: string) {
	console.log(`fibx dev bridge: ${signal} received, closing the spawned server and exiting`);
	await client.close();
	process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

createServer(async (req, res) => {
	// The origin check gates the preflight and the POST alike, and a refusal
	// carries no CORS headers at all — the browser then never hands the
	// response to the calling page.
	const origin = req.headers.origin;
	if (typeof origin !== "string" || !ALLOWED_ORIGINS.has(origin)) {
		res.statusCode = 403;
		return void res.end();
	}
	res.setHeader("access-control-allow-origin", origin);
	res.setHeader("vary", "origin");
	res.setHeader("access-control-allow-headers", "content-type");
	res.setHeader("access-control-allow-methods", "POST, OPTIONS");
	if (req.method === "OPTIONS") return void res.end();
	if (req.method !== "POST" || req.url !== "/call") {
		res.statusCode = 404;
		return void res.end();
	}
	let body = "";
	for await (const chunk of req) body += chunk;
	let name: string;
	let args: Record<string, unknown> | undefined;
	try {
		({ name, arguments: args } = JSON.parse(body) as {
			name: string;
			arguments?: Record<string, unknown>;
		});
	} catch {
		res.statusCode = 400;
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				content: [
					{
						type: "text",
						text: JSON.stringify({ success: false, error: "bad request body" }),
					},
				],
			})
		);
		return;
	}
	if (!RELAYABLE.has(name)) {
		res.statusCode = 403;
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							success: false,
							error: `the dev bridge does not relay ${name}`,
						}),
					},
				],
			})
		);
		return;
	}
	try {
		const result = await client.callTool({ name, arguments: args ?? {} });
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify(result));
	} catch (e) {
		res.statusCode = 500;
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				content: [
					{ type: "text", text: JSON.stringify({ success: false, error: String(e) }) },
				],
			})
		);
	}
}).listen(PORT, "127.0.0.1", () => console.log(`fibx dev bridge on http://127.0.0.1:${PORT}`));
