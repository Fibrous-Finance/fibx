import { defineConfig, type Plugin } from "vitest/config";
import { readFileSync } from "node:fs";

// Vite (which vitest runs on) has no idea `.html` should load as a plain
// string — that mapping only exists in tsup's esbuild `loader` option
// (see tsup.config.ts), which vitest never touches. Without this, Vite's
// import-analysis plugin tries to parse the built panel's inline <script>
// as ESM source and fails. Mirror tsup's "text" loader here so src/mcp/ui.ts
// resolves the same way under both bundlers.
function htmlAsText(): Plugin {
	return {
		name: "html-as-text",
		enforce: "pre",
		load(id) {
			if (id.endsWith(".html")) {
				return `export default ${JSON.stringify(readFileSync(id, "utf-8"))};`;
			}
		},
	};
}

export default defineConfig({
	plugins: [htmlAsText()],
	oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
	test: {
		include: ["src/**/*.test.ts", "ui/src/**/*.test.{ts,tsx}"],
		environment: "node",
	},
});
