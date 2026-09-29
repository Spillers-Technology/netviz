import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { manualChunks, uiAlias, uiDedupe } from "../../ui/vite.shared";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: uiAlias,
    dedupe: uiDedupe,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks } },
  },
  server: {
    fs: { allow: ["..", "../../ui"] },
  },
  test: {
    // The shared ui/ kit's tests run here, where its dependencies are
    // installed, alongside this app's own.
    dir: "../..",
    include: ["ui/src/**/*.test.{ts,tsx}", "desktop/frontend/src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
