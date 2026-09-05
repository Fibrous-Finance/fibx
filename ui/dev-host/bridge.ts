import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * The browser cannot spawn a stdio process, so this relay does: it runs the
 * built server, holds one MCP client to it, and answers the dev host's
 * callServerTool over plain HTTP. Dev only; not built, not published.
 *
 * It talks to the REAL server — a real session, a real policy file, real
 * quotes. A Swap from the dev host in live mode is a real swap.
 */
const PORT = 7331;

const transport = new StdioClientTransport({
	command: "node",
	args: ["dist/index.js", "mcp-start"],
});
const client = new Client({ name: "fibx-dev-host-bridge", version: "0" });
await client.connect(transport);

createServer(async (req, res) => {
	res.setHeader("access-control-allow-origin", "*");
	res.setHeader("access-control-allow-headers", "content-type");
	if (req.method === "OPTIONS") return void res.end();
	if (req.method !== "POST" || req.url !== "/call") {
		res.statusCode = 404;
		return void res.end();
	}
	let body = "";
	for await (const chunk of req) body += chunk;
	const { name, arguments: args } = JSON.parse(body) as {
		name: string;
		arguments?: Record<string, unknown>;
	};
	try {
		const result = await client.callTool({ name, arguments: args ?? {} });
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify(result));
	} catch (e) {
		res.statusCode = 500;
		res.end(
			JSON.stringify({
				content: [
					{ type: "text", text: JSON.stringify({ success: false, error: String(e) }) },
				],
			})
		);
	}
}).listen(PORT, () => console.log(`fibx dev bridge on http://localhost:${PORT}`));
