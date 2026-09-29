import { useCallback, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import SearchOutlined from "@mui/icons-material/SearchOutlined";
import CloseOutlined from "@mui/icons-material/CloseOutlined";
import TableRowsOutlined from "@mui/icons-material/TableRowsOutlined";
import GridViewOutlined from "@mui/icons-material/GridViewOutlined";
import HubOutlined from "@mui/icons-material/HubOutlined";
import RadarOutlined from "@mui/icons-material/RadarOutlined";
import SearchOffOutlined from "@mui/icons-material/SearchOffOutlined";
import {
  DESKTOP_COLUMNS,
  DeviceDetail,
  DeviceTable,
  EmptyState,
  ErrorNotice,
  PageHeader,
  StatusChip,
  Topology,
  hostMatchesFilter,
} from "@netviz/ui";
import { app } from "../../bridge";
import { MONITOR_INTERVALS } from "../../settings";
import type { ScanState } from "../../state/useScan";
import { ScanToolbar } from "./ScanToolbar";
import { GroupsView } from "./GroupsView";

export type NetworkView = "devices" | "groups" | "topology";

const VIEWS: { id: NetworkView; label: string; icon: typeof HubOutlined }[] = [
  { id: "devices", label: "Devices", icon: TableRowsOutlined },
  { id: "groups", label: "Groups", icon: GridViewOutlined },
  { id: "topology", label: "Topology", icon: HubOutlined },
];

export function NetworkWorkspace({
  scan,
  view,
  onViewChange,
  search,
  onSearchChange,
  onOpenPorts,
}: {
  scan: ScanState;
  view: NetworkView;
  onViewChange: (view: NetworkView) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenPorts: () => void;
}) {
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up("lg"));
  const [selectedIP, setSelectedIP] = useState("");

  const needle = search.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? scan.visibleRows.filter((host) => hostMatchesFilter(host, scan.deviceStates[host.ip], needle)) : scan.visibleRows),
    [scan.visibleRows, scan.deviceStates, needle],
  );
  const matches = useMemo(() => (needle ? new Set(shown.map((host) => host.ip)) : null), [needle, shown]);
  const selected = selectedIP ? scan.hosts[selectedIP] : undefined;

  // Selection survives filtering and view switches, and clears only when the
  // device leaves the results entirely.
  useEffect(() => {
    if (selectedIP && !scan.hosts[selectedIP]) setSelectedIP("");
  }, [scan.hosts, selectedIP]);

  const loadHistory = useCallback((ip: string) => app().HostHistory(ip), []);

  const openPorts = scan.rows.reduce((sum, host) => sum + host.open_ports.length, 0);
  const offline = Object.values(scan.deviceStates).filter((state) => state === "offline").length;
  const hidden = scan.rows.length - scan.visibleRows.length;
  const interval = MONITOR_INTERVALS.find((candidate) => candidate.ms === scan.monitorMs)?.label ?? "";

  const status = scan.scanning ? (
    <StatusChip tone="busy" label={scan.total ? `Scanning · ${Math.min(scan.checked, scan.total)} of ${scan.total}` : "Starting scan"} />
  ) : scan.monitoring ? (
    <StatusChip tone="success" label={`Monitoring every ${interval}`} />
  ) : scan.rows.length > 0 ? (
    <StatusChip tone="neutral" label="Ready" />
  ) : null;

  const detail = selected && (
    <DeviceDetail host={selected} state={scan.deviceStates[selected.ip]} loadHistory={loadHistory} onClose={() => setSelectedIP("")} />
  );

  const hasResults = scan.rows.length > 0;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <PageHeader title="Network" subtitle="Scan a range, then pick a device to see its ports and history." status={status}>
        <ScanToolbar scan={scan} onOpenPorts={onOpenPorts} />
      </PageHeader>
      {scan.scanning && (
        <LinearProgress
          variant={scan.total ? "determinate" : "indeterminate"}
          value={scan.total ? Math.min(100, (scan.checked / scan.total) * 100) : undefined}
          aria-label="Scan progress"
        />
      )}
      {(scan.error || scan.portsError) && (
        <Stack spacing={1} sx={{ px: 3, pt: 2 }}>
          <ErrorNotice error={scan.error} onClose={scan.clearError} />
          <ErrorNotice error={scan.portsError} />
        </Stack>
      )}

      {!hasResults ? (
        <Box sx={{ flex: 1, display: "grid", placeItems: "center" }}>
          {scan.scanning ? (
            <EmptyState icon={RadarOutlined} title="Looking for devices">
              Devices appear here as they answer. A /24 usually takes under a minute.
            </EmptyState>
          ) : (
            <EmptyState
              icon={RadarOutlined}
              title="Start with a network"
              action={
                scan.cidrValid && (
                  <Button variant="contained" onClick={() => void scan.startScan(false)}>
                    Scan {scan.cidr.trim()}
                  </Button>
                )
              }
            >
              {scan.detected.length > 0
                ? `This PC is on ${scan.detected.join(", ")}. Scan it to see every device that answers, what it is, and which ports are open.`
                : "Enter a network range above, then scan it to see every device that answers, what it is, and which ports are open."}{" "}
              Nothing leaves this PC.
            </EmptyState>
          )}
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", px: 3, py: 1.5 }}>
              <ToggleButtonGroup exclusive value={view} onChange={(_, value) => value && onViewChange(value)} aria-label="Network view">
                {VIEWS.map(({ id, label, icon: Icon }) => (
                  <ToggleButton key={id} value={id} sx={{ px: 1.5, gap: 0.75 }}>
                    <Icon fontSize="small" />
                    {label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <TextField
                type="search"
                placeholder="Search devices"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                sx={{ flex: "1 1 220px", maxWidth: 380 }}
                slotProps={{
                  htmlInput: { "aria-label": "Find a device" },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchOutlined fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: search && (
                      <InputAdornment position="end">
                        <IconButton aria-label="Clear search" onClick={() => onSearchChange("")} edge="end">
                          <CloseOutlined fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <Typography variant="body2" color="text.secondary" sx={{ ml: "auto" }} role="status">
                {needle ? `${shown.length} of ${scan.visibleRows.length} devices` : `${scan.visibleRows.length} devices`} · {openPorts} open ports
                {offline > 0 && ` · ${offline} offline`}
                {hidden > 0 && ` · ${hidden} silent hidden`}
              </Typography>
            </Stack>
            {view === "devices" && (
              <DeviceTable
                hosts={shown}
                states={scan.deviceStates}
                columns={DESKTOP_COLUMNS}
                selectedIP={selectedIP}
                onSelect={setSelectedIP}
                label="Scan results"
                empty={<NoMatches search={search} hidden={hidden} onClear={() => onSearchChange("")} onShowAll={() => scan.setShowUnresponsive(true)} />}
              />
            )}
            {view === "groups" &&
              (shown.length ? (
                <GroupsView hosts={shown} states={scan.deviceStates} selectedIP={selectedIP} onSelect={setSelectedIP} />
              ) : (
                <NoMatches search={search} hidden={hidden} onClear={() => onSearchChange("")} onShowAll={() => scan.setShowUnresponsive(true)} />
              ))}
            {view === "topology" && (
              <Topology hosts={scan.visibleRows} states={scan.deviceStates} selectedIP={selectedIP} onSelect={setSelectedIP} matches={matches} scanning={scan.scanning} />
            )}
          </Box>
          {wide && detail && (
            <Paper square sx={{ width: 360, flexShrink: 0, borderTop: 0, borderBottom: 0, borderRight: 0 }}>
              {detail}
            </Paper>
          )}
        </Box>
      )}
      {!wide && (
        // Narrow windows: the details float over the right edge without blocking
        // the rest of the page, so views and search stay usable.
        <Drawer
          anchor="right"
          variant="persistent"
          open={Boolean(detail)}
          onKeyDown={(event) => event.key === "Escape" && setSelectedIP("")}
          slotProps={{ paper: { sx: { width: 340, maxWidth: "100%", boxShadow: 8, borderLeft: 1, borderColor: "divider" } } }}
        >
          {detail}
        </Drawer>
      )}
    </Box>
  );
}

function NoMatches({ search, hidden, onClear, onShowAll }: { search: string; hidden: number; onClear: () => void; onShowAll: () => void }) {
  if (search.trim()) {
    return (
      <EmptyState icon={SearchOffOutlined} title="No matching devices" compact action={<Button onClick={onClear}>Clear search</Button>}>
        Nothing matches “{search.trim()}”.
      </EmptyState>
    );
  }
  return (
    <EmptyState icon={SearchOffOutlined} title="Nothing answered yet" compact action={hidden > 0 && <Button onClick={onShowAll}>Show silent addresses</Button>}>
      {hidden > 0 ? `${hidden} addresses were checked but didn't answer.` : "No devices have answered on this range."}
    </EmptyState>
  );
}
