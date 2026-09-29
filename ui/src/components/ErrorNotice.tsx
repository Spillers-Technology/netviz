import { useState, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import type { FriendlyError } from "../errors";

// ErrorNotice shows the plain-language lead first and keeps the original
// error one click away under Details, so nothing a technician might need to
// search for is lost.
export function ErrorNotice({ error, onClose, action }: { error: FriendlyError | null; onClose?: () => void; action?: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!error) return null;
  const hasDetails = Boolean(error.details) && error.details !== error.lead;
  return (
    <Alert
      severity="error"
      variant="outlined"
      onClose={onClose}
      role="alert"
      sx={{ bgcolor: "background.paper", alignItems: "flex-start" }}
      action={action}
    >
      <Box>{error.lead}</Box>
      {hasDetails && (
        <>
          <Button size="small" color="inherit" onClick={() => setOpen((value) => !value)} aria-expanded={open} sx={{ px: 0, minWidth: 0, mt: 0.5, textDecoration: "underline" }}>
            {open ? "Hide details" : "Details"}
          </Button>
          <Collapse in={open}>
            <Box component="pre" sx={{ m: 0, mt: 0.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, opacity: 0.85 }}>
              {error.details}
            </Box>
          </Collapse>
        </>
      )}
    </Alert>
  );
}
