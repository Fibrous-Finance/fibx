import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
	root: "ui",
	plugins: [viteSingleFile()],
	esbuild: { jsx: "automatic", jsxImportSource: "preact" },
	build: { outDir: "dist", emptyOutDir: true },
});
