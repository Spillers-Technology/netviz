import type { ReactNode } from "react";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "../theme";
import { ConfirmProvider } from "../hooks/useConfirm";
import { ToastProvider } from "../hooks/useToast";

// NetvizRoot wires the theme (light/dark following the system unless the user
// picks one), the baseline styles and the shared dialog and toast providers.
export function NetvizRoot({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme} defaultMode="system" modeStorageKey="netviz.theme">
      <CssBaseline enableColorScheme />
      <ConfirmProvider>
        <ToastProvider>{children}</ToastProvider>
      </ConfirmProvider>
    </ThemeProvider>
  );
}
