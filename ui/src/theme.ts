import { createTheme } from "@mui/material/styles";

// Spillers brand, shared with PartnerCenterBridge: deep navy and azure in the
// dark scheme, a darker azure on light surfaces so text keeps AA contrast.
// Status colors are paired with an icon and a label everywhere (StatusChip).
export const surfaces = {
  light: { page: "#f4f7fb", paper: "#ffffff", raised: "#eef3f8", line: "#d6dfe8" },
  dark: { page: "#071426", paper: "#10243b", raised: "#152e47", line: "#334155" },
} as const;

export const monoFont = '"Cascadia Code", "Cascadia Mono", ui-monospace, Consolas, "SFMono-Regular", monospace';

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "class" },
  colorSchemes: {
    light: {
      palette: {
        background: { default: surfaces.light.page, paper: surfaces.light.paper },
        divider: surfaces.light.line,
        text: { primary: "#0f1b2d", secondary: "#4a5a6e" },
        primary: { light: "#3a9cc0", main: "#007fa8", dark: "#006a8d", contrastText: "#ffffff" },
        success: { main: "#1a7f37" },
        warning: { main: "#9a6700" },
        error: { main: "#cf222e" },
        info: { main: "#0969da" },
      },
    },
    dark: {
      palette: {
        background: { default: surfaces.dark.page, paper: surfaces.dark.paper },
        divider: surfaces.dark.line,
        text: { primary: "#e2e8f0", secondary: "#94a3b8" },
        primary: { light: "#67dcff", main: "#00c2ff", dark: "#0094d6", contrastText: "#0b1020" },
        success: { main: "#4ade80" },
        warning: { main: "#fbbf24" },
        error: { main: "#f87171" },
        info: { main: "#67dcff" },
      },
    },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif',
    fontSize: 13,
    h1: { fontSize: "1.375rem", fontWeight: 650, letterSpacing: "-0.01em" },
    h2: { fontSize: "1.0625rem", fontWeight: 650 },
    h3: { fontSize: "0.9375rem", fontWeight: 650 },
    body1: { fontSize: "0.875rem" },
    body2: { fontSize: "0.8125rem" },
    subtitle2: { fontWeight: 650 },
    button: { textTransform: "none", fontWeight: 600 },
    overline: { fontWeight: 700, letterSpacing: "0.08em", lineHeight: 1.6 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true, size: "small" } },
    MuiIconButton: { defaultProps: { size: "small" } },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiSelect: { defaultProps: { size: "small" } },
    MuiToggleButtonGroup: { defaultProps: { size: "small" } },
    MuiChip: { defaultProps: { size: "small" } },
    MuiTable: { defaultProps: { size: "small" } },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: ({ theme }) => ({ backgroundImage: "none", border: `1px solid ${theme.vars.palette.divider}` }),
      },
    },
    MuiAppBar: { styleOverrides: { root: { border: 0 } } },
    MuiDrawer: { styleOverrides: { paper: { border: 0 } } },
    MuiMenu: { styleOverrides: { paper: { border: 0 } } },
    MuiPopover: { styleOverrides: { paper: { border: 0 } } },
    MuiDialog: { styleOverrides: { paper: { border: 0 } } },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiTableCell: {
      styleOverrides: {
        head: ({ theme }) => ({ fontWeight: 650, color: theme.vars.palette.text.secondary, whiteSpace: "nowrap" }),
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        "html, body, #root": { height: "100%" },
        body: { overflow: "hidden" },
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": { animationDuration: "0.01ms !important", transitionDuration: "0.01ms !important" },
        },
      },
    },
  },
});
