import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds into the Go server's embedded webdist with fixed asset names so the
// committed output stays reviewable and `go build` never needs node.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../internal/server/webdist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/index[extname]",
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
});
