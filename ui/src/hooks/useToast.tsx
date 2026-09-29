import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import Alert, { type AlertColor } from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";

type Toast = { id: number; message: string; severity: AlertColor };

const ToastContext = createContext<((message: string, severity?: AlertColor) => void) | null>(null);

// One message at a time, bottom right; a newer message replaces the current
// one rather than stacking. For confirmations of things that already happened
// ("Copied", "Scan saved") — failures that need action use ErrorNotice.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const show = useCallback((message: string, severity: AlertColor = "success") => {
    setToast({ id: Date.now(), message, severity });
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <Snackbar
        key={toast?.id}
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={(_, reason) => reason !== "clickaway" && setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        {toast ? (
          <Alert variant="filled" severity={toast.severity} onClose={() => setToast(null)} sx={{ width: "100%" }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside ToastProvider");
  return show;
}
