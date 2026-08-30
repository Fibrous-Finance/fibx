import { defineConfig, type Options } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	platform: "node",
	target: "node18",
	outDir: "dist",

	bundle: true,
	treeshake: true,
	minify: true,
	splitting: false,
	sourcemap: true,
	clean: true,

	// Bundle ALL dependencies into the output file.
	// This way the published package has zero production deps,
	// making `npx fibx` near-instant.
	noExternal: [/.*/],

	// Inject version at build time so the bundle doesn't need package.json.
	esbuildOptions(options) {
		options.define = {
			...options.define,
			FIBX_VERSION: JSON.stringify(pkg.version),
		};
		options.loader = {
			...options.loader,
			// The panel is a build artifact, not a dependency: Vite bundles it
			// into one self-contained file and esbuild inlines that file's text
			// into the server bundle.
			".html": "text",
		};
	},

	// Some bundled deps (MCP SDK, inquirer) use CJS require() for Node
	// builtins like 'events', 'http', etc. ESM output doesn't have a
	// global `require`, so we inject one via createRequire.
	banner: {
		js: [
			'import { createRequire as __bundled_createRequire__ } from "node:module";',
			'import { fileURLToPath as __bundled_fileURLToPath__ } from "node:url";',
			'import { dirname as __bundled_dirname__ } from "node:path";',
			"const __filename = __bundled_fileURLToPath__(import.meta.url);",
			"const __dirname = __bundled_dirname__(__filename);",
			"const require = __bundled_createRequire__(import.meta.url);",
		].join("\n"),
	},

	// tsup auto-detects the shebang (#!/usr/bin/env node) in src/index.ts
	// and preserves it in the output, making dist/index.js executable.
} satisfies Options);
