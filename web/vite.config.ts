import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { manualChunks, uiAlias, uiDedupe } from "../ui/vite.shared";

// Builds into the Go server's embedded webdist with fixed asset names so the
// committed output stays reviewable and `go build` never needs node. The 3D
// map is its own chunk, fetched only when someone opens the Map view.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: uiAlias,
    dedupe: uiDedupe,
  },
  build: {
    outDir: "../internal/server/webdist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks,
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/index[extname]",
      },
    },
  },
  server: {
    fs: { allow: ["..", "../ui"] },
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
});
