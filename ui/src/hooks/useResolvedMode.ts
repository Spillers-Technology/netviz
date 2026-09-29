import { useColorScheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";

// useResolvedMode answers "light or dark right now" for code that needs real
// colors rather than CSS variables — the three.js scene and canvas drawing.
export function useResolvedMode(): "light" | "dark" {
  const { mode, systemMode } = useColorScheme();
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  if (mode === "light" || mode === "dark") return mode;
  if (systemMode === "light" || systemMode === "dark") return systemMode;
  return prefersDark ? "dark" : "light";
}

export function usePrefersReducedMotion() {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
