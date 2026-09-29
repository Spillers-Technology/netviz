import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { SvgIconComponent } from "@mui/icons-material";

// EmptyState is one heading, one sentence and at most one action — never a
// dead grey box.
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  compact = false,
}: {
  icon?: SvgIconComponent;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <Stack spacing={1.25} sx={{ alignItems: "center", justifyContent: "center", textAlign: "center", py: compact ? 3 : 6, px: 3, maxWidth: 520, mx: "auto" }}>
      {Icon && (
        <Box sx={{ width: 48, height: 48, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "action.hover", color: "primary.main" }}>
          <Icon />
        </Box>
      )}
      <Typography variant="h2" component="h2">
        {title}
      </Typography>
      {children && (
        <Typography variant="body2" color="text.secondary" component="div">
          {children}
        </Typography>
      )}
      {action && <Box sx={{ pt: 0.5 }}>{action}</Box>}
    </Stack>
  );
}
