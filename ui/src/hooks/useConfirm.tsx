import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  // items lists exactly what will change, one line each.
  items?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  // destructive and mutating dialogs start with focus on Cancel, so a
  // reflexive Enter never changes anything.
  destructive?: boolean;
  mutating?: boolean;
};

type Pending = ConfirmOptions & { resolve: (confirmed: boolean) => void };

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));

  const confirm = useCallback((options: ConfirmOptions) => {
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  function close(confirmed: boolean) {
    pendingRef.current?.resolve(confirmed);
    pendingRef.current = null;
    setPending(null);
  }

  const cautious = Boolean(pending?.destructive || pending?.mutating);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={Boolean(pending)} onClose={() => close(false)} fullScreen={fullScreen} maxWidth="xs" fullWidth aria-labelledby="confirm-title">
        {pending && (
          <>
            <DialogTitle id="confirm-title">{pending.title}</DialogTitle>
            <DialogContent>
              {pending.body && <DialogContentText component="div">{pending.body}</DialogContentText>}
              {pending.items && pending.items.length > 0 && (
                <List dense disablePadding sx={{ mt: 1 }}>
                  {pending.items.map((item) => (
                    <ListItem key={item} disableGutters sx={{ py: 0.25 }}>
                      <ListItemText primary={`• ${item}`} />
                    </ListItem>
                  ))}
                </List>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => close(false)} autoFocus={cautious}>
                {pending.cancelLabel || "Cancel"}
              </Button>
              <Button
                variant="contained"
                color={pending.destructive ? "error" : "primary"}
                onClick={() => close(true)}
                autoFocus={!cautious}
              >
                {pending.confirmLabel}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside ConfirmProvider");
  return confirm;
}
