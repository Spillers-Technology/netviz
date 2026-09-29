import Box from "@mui/material/Box";

// BrandMark is the NetViz glyph: a gateway with devices on a ring around it,
// the same picture the topology view draws.
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 32 32"
      aria-hidden="true"
      sx={{ width: size, height: size, flexShrink: 0, color: "primary.main" }}
    >
      <rect x="1" y="1" width="30" height="30" rx="8" fill="currentColor" opacity="0.14" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.2" />
      <g stroke="currentColor" strokeWidth="1.4" strokeOpacity="0.7">
        <line x1="16" y1="16" x2="16" y2="7" />
        <line x1="16" y1="16" x2="24" y2="20.5" />
        <line x1="16" y1="16" x2="8" y2="20.5" />
      </g>
      <circle cx="16" cy="16" r="3.4" fill="currentColor" />
      <circle cx="16" cy="7" r="2.2" fill="currentColor" />
      <circle cx="24" cy="20.5" r="2.2" fill="currentColor" />
      <circle cx="8" cy="20.5" r="2.2" fill="currentColor" />
    </Box>
  );
}
