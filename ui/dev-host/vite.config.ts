import { defineConfig } from "vite";

// Dev only. Root is `ui` so the built widget at ui/dist/index.html is served
// as /dist/index.html for the iframe; the page itself is /dev-host/.
export default defineConfig({
	root: "ui",
	server: { open: "/dev-host/index.html" },
});
