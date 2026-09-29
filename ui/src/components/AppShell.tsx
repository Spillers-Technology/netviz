import { useEffect, useRef, useState, type ReactNode } from "react";
import AppBar from "@mui/material/AppBar";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import MenuOutlined from "@mui/icons-material/MenuOutlined";
import type { SvgIconComponent } from "@mui/icons-material";
import { BrandMark } from "./BrandMark";

export type NavItem = {
  id: string;
  label: string;
  description: string;
  icon: SvgIconComponent;
  // badge shows a small dot; badgeLabel is what a screen reader hears.
  badge?: boolean;
  badgeLabel?: string;
};

const SIDEBAR = 216;
const RAIL = 84;

// AppShell is the frame for every NetViz workspace: sidebar (a rail on narrow
// windows, a drawer on phones), a skip link, and a main region that takes
// focus whenever the workspace changes. Navigation never grows past six
// destinations; new screens live inside an existing one.
export function AppShell({
  product,
  tagline,
  nav,
  footerNav = [],
  footer,
  active,
  onNavigate,
  children,
}: {
  product: string;
  tagline: string;
  nav: NavItem[];
  footerNav?: NavItem[];
  footer?: ReactNode;
  active: string;
  onNavigate: (id: string) => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down("sm"));
  const rail = useMediaQuery(theme.breakpoints.between("sm", "md"));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [active]);

  function go(id: string) {
    setDrawerOpen(false);
    onNavigate(id);
  }

  const width = rail ? RAIL : SIDEBAR;
  const sidebar = (
    <Stack component="nav" aria-label="Workspaces" sx={{ height: "100%", width, py: 1.5, px: rail ? 1 : 1.5, gap: 0.5 }}>
      <Stack direction={rail ? "column" : "row"} spacing={1} sx={{ alignItems: "center", px: rail ? 0 : 1, pb: 2 }}>
        <BrandMark size={rail ? 30 : 28} />
        {!rail && (
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 16, lineHeight: 1.1 }}>{product}</Typography>
            <Typography variant="caption" color="text.secondary">{tagline}</Typography>
          </Box>
        )}
      </Stack>
      {nav.map((item) => (
        <NavButton key={item.id} item={item} active={active === item.id} rail={rail} onClick={() => go(item.id)} />
      ))}
      <Box sx={{ flex: 1 }} />
      {footerNav.map((item) => (
        <NavButton key={item.id} item={item} active={active === item.id} rail={rail} onClick={() => go(item.id)} />
      ))}
      {footer && !rail && <Box sx={{ px: 1, pt: 1 }}>{footer}</Box>}
    </Stack>
  );

  return (
    <Box sx={{ display: "flex", height: "100%", bgcolor: "background.default", color: "text.primary" }}>
      <Box
        component="a"
        href="#main"
        onClick={(event: React.MouseEvent) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
        sx={{
          position: "absolute",
          left: 8,
          top: -48,
          zIndex: 2000,
          px: 2,
          py: 1,
          borderRadius: 1,
          bgcolor: "primary.main",
          color: "primary.contrastText",
          "&:focus": { top: 8 },
        }}
      >
        Skip to content
      </Box>
      {phone ? (
        <>
          <AppBar position="fixed" color="inherit" sx={{ bgcolor: "background.paper", borderBottom: 1, borderColor: "divider" }} elevation={0}>
            <Toolbar variant="dense" sx={{ gap: 1 }}>
              <IconButton edge="start" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>
                <MenuOutlined />
              </IconButton>
              <BrandMark size={22} />
              <Typography sx={{ fontWeight: 700 }}>{product}</Typography>
            </Toolbar>
          </AppBar>
          <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} slotProps={{ paper: { sx: { bgcolor: "background.paper" } } }}>
            {sidebar}
          </Drawer>
        </>
      ) : (
        <Box sx={{ flexShrink: 0, bgcolor: "background.paper", borderRight: 1, borderColor: "divider" }}>{sidebar}</Box>
      )}
      <Box
        component="main"
        id="main"
        ref={mainRef}
        tabIndex={-1}
        sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "auto", outline: "none", pt: phone ? 6 : 0 }}
      >
        {children}
      </Box>
    </Box>
  );
}

function NavButton({ item, active, rail, onClick }: { item: NavItem; active: boolean; rail: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <ButtonBase
      onClick={onClick}
      data-nav={item.id}
      aria-current={active ? "page" : undefined}
      aria-label={rail ? item.label : undefined}
      title={rail ? item.description : undefined}
      sx={{
        justifyContent: rail ? "center" : "flex-start",
        textAlign: "left",
        gap: 1.25,
        px: rail ? 0.5 : 1.25,
        py: rail ? 1 : 0.875,
        borderRadius: 1,
        color: active ? "text.primary" : "text.secondary",
        bgcolor: active ? "action.selected" : "transparent",
        flexDirection: rail ? "column" : "row",
        "&:hover": { bgcolor: active ? "action.selected" : "action.hover" },
        "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineStyle: "solid" },
      }}
    >
      <Badge color="warning" variant="dot" invisible={!item.badge}>
        <Icon fontSize="small" sx={{ color: active ? "primary.main" : "inherit" }} />
      </Badge>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: rail ? 11 : 13.5, fontWeight: active ? 650 : 500, lineHeight: 1.25 }}>{item.label}</Typography>
        {!rail && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.3 }}>
            {item.description}
          </Typography>
        )}
        {item.badge && item.badgeLabel && (
          <Box component="span" sx={visuallyHidden}>
            {item.badgeLabel}
          </Box>
        )}
      </Box>
    </ButtonBase>
  );
}

export const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;
