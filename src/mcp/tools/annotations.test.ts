import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { registerAuthAndConfigTools } from "./auth.js";
import { registerPolicyTools } from "./policy.js";

/**
 * No test in this repo pinned any tool's `readOnlyHint` / `destructiveHint`
 * before this one — an annotation flip is a security mistake (see
 * set_policy_rule's `destructiveHint: false`, corrected alongside this test)
 * that would otherwise ship silently.
 *
 * This registers the real tools against a real McpServer rather than
 * asserting on exported config objects: `registerTool` returns the
 * `RegisteredTool` it stores, and the SDK keeps every registration on the
 * server instance keyed by name (`_registeredTools`, used internally for
 * `tools/list` and `tools/call`). Registering never invokes a handler, so
 * this never touches disk, a chain, or the relay — it only inspects what got
 * registered. `_registeredTools` is a private field in the SDK's TypeScript
 * types but a plain object at runtime; reading it here is the only way to
 * reach the recorded annotations without re-deriving them from source.
 */
function annotationsOf(server: McpServer, name: string): ToolAnnotations | undefined {
	const registry = (
		server as unknown as { _registeredTools: Record<string, { annotations?: ToolAnnotations }> }
	)._registeredTools;
	const tool = registry[name];
	if (!tool) throw new Error(`Tool "${name}" was not registered.`);
	return tool.annotations;
}

function buildServer(): McpServer {
	const server = new McpServer({ name: "fibx-test", version: "0.0.0" });
	registerAuthAndConfigTools(server);
	registerPolicyTools(server);
	return server;
}

describe("tool annotations", () => {
	const server = buildServer();

	// readOnlyHint: true is what makes opening the panel inert — get_auth_status
	// is bound to the wallet panel resource, and a host that renders it must be
	// able to trust that doing so triggers no write, no chain call it didn't ask
	// for, and no approval prompt.
	it("get_auth_status is read-only and non-destructive", () => {
		const annotations = annotationsOf(server, "get_auth_status");
		expect(annotations?.readOnlyHint).toBe(true);
		expect(annotations?.destructiveHint).toBe(false);
	});

	it("get_policy is read-only and non-destructive", () => {
		const annotations = annotationsOf(server, "get_policy");
		expect(annotations?.readOnlyHint).toBe(true);
		expect(annotations?.destructiveHint).toBe(false);
	});

	// Not read-only — it writes the file that bounds every signature — and not
	// additive either: it replaces an existing rule's value, which can loosen a
	// bound as easily as tighten one. destructiveHint: false here would
	// contradict clear_policy_rule's destructiveHint: true for the identical
	// consequence, a cap that stops binding.
	it("set_policy_rule is not read-only and is destructive", () => {
		const annotations = annotationsOf(server, "set_policy_rule");
		expect(annotations?.readOnlyHint).toBe(false);
		expect(annotations?.destructiveHint).toBe(true);
	});

	it("clear_policy_rule is not read-only and is destructive", () => {
		const annotations = annotationsOf(server, "clear_policy_rule");
		expect(annotations?.readOnlyHint).toBe(false);
		expect(annotations?.destructiveHint).toBe(true);
	});

	// Ends a session and reaches the relay to tear down the pairing — not
	// read-only, and destructive to the thing it acts on (the active session).
	it("logout is not read-only and is destructive", () => {
		const annotations = annotationsOf(server, "logout");
		expect(annotations?.readOnlyHint).toBe(false);
		expect(annotations?.destructiveHint).toBe(true);
	});
});
