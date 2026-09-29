// Shared Vite settings for the desktop and server frontends. The ui/ kit is
// source only (no install of its own), so every package it imports must
// resolve from the consuming app's node_modules; dedupe forces that and keeps
// one copy of React, MUI and three.js in each bundle.
import path from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = path.dirname(fileURLToPath(import.meta.url));

export const uiAlias = { "@netviz/ui": path.join(uiRoot, "src") };

export const uiDedupe = [
  "react",
  "react-dom",
  "@mui/material",
  "@mui/icons-material",
  "@mui/system",
  "@emotion/react",
  "@emotion/styled",
  "three",
  "@react-three/fiber",
  "@react-three/drei",
  "@react-three/postprocessing",
  "postprocessing",
  // Test-only, for the kit's component tests.
  "@testing-library/react",
  "@testing-library/dom",
];

// Keep MUI in its own long-lived chunk so app changes don't invalidate it.
// three.js is deliberately not listed: the lazy topology import already splits
// it out, and a manual chunk would let shared helpers pull it into startup.
export function manualChunks(id: string) {
  if (!id.includes("node_modules")) return undefined;
  if (/[\\/](@mui|@emotion)[\\/]/.test(id)) return "mui";
  return undefined;
}
