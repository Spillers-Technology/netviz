import { useMemo } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  CATEGORY_COLORS,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  CategoryLabel,
  DeviceStateChip,
  categoryFor,
  hostLabel,
  monoFont,
  useResolvedMode,
  type Category,
  type DeviceState,
  type HostObservation,
} from "@netviz/ui";

// GroupsView is the "scan the list" view: one card per device type that is
// actually present, devices as compact tiles inside it.
export function GroupsView({
  hosts,
  states,
  selectedIP,
  onSelect,
}: {
  hosts: HostObservation[];
  states: Record<string, DeviceState>;
  selectedIP: string;
  onSelect: (ip: string) => void;
}) {
  const mode = useResolvedMode();
  const groups = useMemo(() => {
    const map = new Map<Category, HostObservation[]>();
    for (const host of hosts) {
      const category = categoryFor(host);
      map.set(category, [...(map.get(category) || []), host]);
    }
    return CATEGORY_ORDER.filter((category) => map.has(category)).map((category) => ({ category, hosts: map.get(category)! }));
  }, [hosts]);

  return (
    <Box sx={{ flex: 1, overflow: "auto", p: 2, display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", alignContent: "start" }}>
      {groups.map((group) => (
        <Paper key={group.category} component="section" aria-label={`${CATEGORY_LABEL[group.category]} devices`} sx={{ p: 1.5, borderTop: 3, borderTopColor: CATEGORY_COLORS[mode][group.category] }}>
          <Box sx={{ mb: 1 }}>
            <CategoryLabel category={group.category} count={group.hosts.length} />
          </Box>
          <Stack spacing={0.75}>
            {group.hosts.map((host) => {
              const selected = host.ip === selectedIP;
              const state = states[host.ip] || "stable";
              return (
                <ButtonBase
                  key={host.ip}
                  onClick={() => onSelect(selected ? "" : host.ip)}
                  aria-pressed={selected}
                  data-ip={host.ip}
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 1,
                    textAlign: "left",
                    px: 1.25,
                    py: 0.75,
                    borderRadius: 1,
                    border: 1,
                    borderColor: selected ? "primary.main" : "divider",
                    bgcolor: selected ? "action.selected" : "background.default",
                    opacity: host.alive || host.open_ports.length ? 1 : 0.7,
                    "&:hover": { borderColor: "primary.main" },
                    "&.Mui-focusVisible": { outline: 2, outlineStyle: "solid", outlineColor: "primary.main" },
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                      {hostLabel(host)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
                      {host.ip}
                      {host.open_ports.length > 0 && ` · ${host.open_ports.length} open`}
                    </Typography>
                  </Box>
                  {state !== "stable" && <DeviceStateChip state={state} />}
                </ButtonBase>
              );
            })}
          </Stack>
        </Paper>
      ))}
    </Box>
  );
}
