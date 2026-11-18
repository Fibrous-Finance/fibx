// Starts the built bundle the way a user does, on whatever Node runs this.
//
// A bundle can build cleanly and still crash on start — a sibling project
// shipped one. `--version` alone is not enough here: esbuild inlines every
// dynamic import as a lazy initialiser, so the MCP server's modules are only
// evaluated when `mcp-start` runs. This script exercises both paths.
//
// HOME points at a throwaway directory so nothing reads or writes the real
// config directory (env-paths resolves it from the home directory).

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = "dist/index.js";
const { version } = JSON.parse(readFileSync("package.json", "utf-8"));
const home = mkdtempSync(join(tmpdir(), "fibx-smoke-"));
const env = { ...process.env, HOME: home, USERPROFILE: home };

function fail(message) {
	rmSync(home, { recursive: true, force: true });
	console.error(`smoke: ${message}`);
	process.exit(1);
}

const run = spawnSync(process.execPath, [BIN, "--version"], {
	env,
	encoding: "utf-8",
	timeout: 30_000,
});
if (run.status !== 0) fail(`--version exited ${run.status}\n${run.stderr}`);
if (run.stdout.trim() !== version) {
	fail(`--version printed "${run.stdout.trim()}", expected "${version}"`);
}
console.log(`smoke: fibx --version → ${version} on Node ${process.versions.node}`);

// The stdio server exits on its own once stdin closes; the timer only bounds
// a server that does not, so a hang fails the job instead of eating it.
const server = spawn(process.execPath, [BIN, "mcp-start"], {
	env,
	stdio: ["pipe", "pipe", "pipe"],
});
const timer = setTimeout(() => {
	server.kill("SIGKILL");
	fail("mcp-start did not exit within 30s of stdin closing");
}, 30_000);

let stdout = "";
let stderr = "";
server.stdout.on("data", (chunk) => (stdout += chunk));
server.stderr.on("data", (chunk) => (stderr += chunk));

const messages = [
	{
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "fibx-smoke", version: "0" },
		},
	},
	{ jsonrpc: "2.0", method: "notifications/initialized" },
	{ jsonrpc: "2.0", id: 2, method: "tools/list" },
];
server.stdin.end(messages.map((m) => JSON.stringify(m)).join("\n") + "\n");

server.on("close", (code) => {
	clearTimeout(timer);
	if (code !== 0) fail(`mcp-start exited ${code}\n${stderr}`);

	const replies = stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	const init = replies.find((r) => r.id === 1);
	const list = replies.find((r) => r.id === 2);
	if (init?.result?.serverInfo?.version !== version) {
		fail(`initialize did not report version ${version}: ${JSON.stringify(init)}`);
	}
	const tools = list?.result?.tools;
	if (!Array.isArray(tools) || tools.length === 0) {
		fail(`tools/list returned no tools: ${JSON.stringify(list)}`);
	}

	rmSync(home, { recursive: true, force: true });
	console.log(`smoke: mcp-start answered initialize and listed ${tools.length} tools`);
});
