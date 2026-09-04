import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// vite-plugin-singlefile inlines everything into ONE html file, and its own
// README says so explicitly: it is not designed for multiple entry points,
// and issues asking for that are closed as wontfix. On this repo's installed
// Vite 8 (Rolldown) toolchain that shows up as a hard build error rather than
// a silent one: listing both HTML files as a single multi-input build trips
// "multiple inputs are not supported when output.codeSplitting is false" —
// codeSplitting:false being exactly the flag the plugin sets to force full
// inlining for a single entry. Splitting into two single-entry builds (one
// per document, selected by FIBX_UI_ENTRY, run twice from build:ui) is the
// supported shape: each build has exactly one input, so nothing is shared.
const entries = {
	panel: "index.html",
	swap: "swap-card.html",
} as const;

const entry = (process.env.FIBX_UI_ENTRY as keyof typeof entries | undefined) ?? "panel";

export default defineConfig({
	root: "ui",
	plugins: [viteSingleFile()],
	esbuild: { jsx: "automatic", jsxImportSource: "preact" },
	build: {
		outDir: "dist",
		// Only the first of the two build:ui invocations may clear dist/,
		// or it would delete the other entry's already-built output.
		emptyOutDir: entry === "panel",
		rollupOptions: {
			input: resolve("ui", entries[entry]),
		},
	},
});
