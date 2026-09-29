import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { CATEGORY_COLORS, CATEGORY_ICON } from "../categories";
import { CATEGORY_LABEL, type Category } from "../net";
import { useResolvedMode } from "../hooks/useResolvedMode";

// CategoryLabel is a device type in three redundant encodings: a colored
// icon tile, the icon's shape, and the name in words.
export function CategoryLabel({ category, count, dense = false }: { category: Category; count?: number; dense?: boolean }) {
  const mode = useResolvedMode();
  const Icon = CATEGORY_ICON[category];
  const color = CATEGORY_COLORS[mode][category];
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0 }}>
      <Box
        aria-hidden="true"
        sx={{
          width: dense ? 20 : 24,
          height: dense ? 20 : 24,
          borderRadius: 0.75,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          bgcolor: color,
          color: "#fff",
        }}
      >
        <Icon sx={{ fontSize: dense ? 14 : 16 }} />
      </Box>
      <Typography variant="body2" noWrap sx={{ fontWeight: dense ? 400 : 600 }}>
        {CATEGORY_LABEL[category]}
      </Typography>
      {count !== undefined && (
        <Typography variant="body2" color="text.secondary">
          {count}
        </Typography>
      )}
    </Stack>
  );
}
