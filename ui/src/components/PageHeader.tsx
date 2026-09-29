import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

// PageHeader opens every workspace: one h1, one sentence saying what the page
// is for, status chips, and the page's actions on the right. Anything passed
// as children renders as a toolbar row underneath.
export function PageHeader({
  title,
  subtitle,
  status,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Box component="header" sx={{ px: { xs: 2, sm: 3 }, pt: 2.5, pb: 2, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
      <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
        <Box sx={{ minWidth: 0, flex: "1 1 320px" }}>
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="h1">{title}</Typography>
            {status}
          </Stack>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {actions && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            {actions}
          </Stack>
        )}
      </Stack>
      {children && <Box sx={{ mt: 2 }}>{children}</Box>}
    </Box>
  );
}
