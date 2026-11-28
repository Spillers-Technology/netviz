import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import HubOutlined from "@mui/icons-material/HubOutlined";
import SensorsOutlined from "@mui/icons-material/SensorsOutlined";
import RefreshOutlined from "@mui/icons-material/RefreshOutlined";
import SearchOutlined from "@mui/icons-material/SearchOutlined";
import CloseOutlined from "@mui/icons-material/CloseOutlined";
import TableRowsOutlined from "@mui/icons-material/TableRowsOutlined";
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import SearchOffOutlined from "@mui/icons-material/SearchOffOutlined";
import LogoutOutlined from "@mui/icons-material/LogoutOutlined";
import {
  AppShell,
  DeviceDetail,
  DeviceTable,
  EmptyState,
  ErrorNotice,
  NetvizRoot,
  PageHeader,
  SERVER_COLUMNS,
  StatusChip,
  Topology,
  WorkspaceBoundary,
  compareIP,
  formatAge,
  friendlyError,
  hostMatchesFilter,
  monoFont,
  normalizeHost,
  useToast,
  type FriendlyError,
  type NavItem,
} from "@netviz/ui";
import type { Identity, ProbeStatus, ServerState } from "./types";
import { demoState } from "./demo";
import ManagedProbes, { requestManagement, type ManagedInventory } from "./ManagedProbes";

const REFRESH_MS = 10_000;
const PROBE_STALE_MS = 5 * 60 * 1000;

type Load = { status: "loading" } | { status: "ready" };

function useServerState(demo: boolean, probeId: string) {
  const [snapshot, setSnapshot] = useState<{ probeId: string; state: ServerState }>();
  const state = snapshot?.probeId === probeId ? snapshot.state : null;
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const activeRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    activeRequest.current?.abort();
    const request = new AbortController();
    activeRequest.current = request;
    if (demo) {
      setSnapshot({ probeId, state: demoState() });
      setRefreshedAt(new Date());
      setLoad({ status: "ready" });
      return;
    }
    setRefreshing(true);
    try {
      const response = await fetch(probeId ? `/api/state?probe=${encodeURIComponent(probeId)}` : "/api/state", { signal: request.signal });
      if (!response.ok) throw new Error(`state request failed with status ${response.status}`);
      const next = (await response.json()) as ServerState;
      if (request.signal.aborted) return;
      setSnapshot({ probeId, state: { ...next, devices: (next.devices || []).map(normalizeHost) } });
      setRefreshedAt(new Date());
      setError(null);
    } catch (err) {
      if (!request.signal.aborted) setError(friendlyError(err, "Refreshing the inventory"));
    } finally {
      if (!request.signal.aborted) {
        setRefreshing(false);
        setLoad({ status: "ready" });
      }
    }
  }, [demo, probeId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => { activeRequest.current?.abort(); window.clearInterval(timer); };
  }, [refresh]);

  return { state, load, refreshing, error, refreshedAt, refresh };
}

function probeFreshness(probe?: ProbeStatus) {
  if (!probe) return { tone: "neutral" as const, label: "Waiting for a probe" };
  const age = Date.now() - new Date(probe.last_seen).getTime();
  return age > PROBE_STALE_MS
    ? { tone: "warning" as const, label: `Probe quiet · last seen ${formatAge(age)} ago` }
    : { tone: "success" as const, label: `Probe reporting · seen ${formatAge(age)} ago` };
}

function App() {
  const demo = useMemo(() => new URLSearchParams(window.location.search).has("demo"), []);
  const [probeId, setProbeId] = useState("");
  const [managed, setManaged] = useState<ManagedInventory | null>(null);
  const [managementError, setManagementError] = useState("");
  const selectedProbeId = probeId || managed?.probes[0]?.id || "legacy";
  const server = useServerState(demo, selectedProbeId === "legacy" ? "" : selectedProbeId);
  const refreshManagement = useCallback(async () => {
    if (demo) return;
    try {
      setManaged(await requestManagement<ManagedInventory>());
      setManagementError("");
    } catch (error) {
      setManagementError((error as Error).message);
    }
  }, [demo]);
  useEffect(() => {
    void refreshManagement();
    const timer = window.setInterval(() => void refreshManagement(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshManagement]);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [workspace, setWorkspace] = useState<"network" | "probes">("network");
  const [view, setView] = useState<"devices" | "map">("devices");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (demo) return;
    fetch("/api/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((me) => setIdentity(me))
      .catch(() => {
        // Identity is optional: servers without SSO have no /api/me user.
      });
  }, [demo]);

  const nav: NavItem[] = [
    { id: "network", label: "Network", description: "Latest reported devices", icon: HubOutlined },
    { id: "probes", label: "Probes", description: "Reporting and setup", icon: SensorsOutlined, badge: !server.state?.probe && server.load.status === "ready", badgeLabel: "No probe connected" },
  ];

  const freshness = probeFreshness(server.state?.probe);
  const actions = (
    <>
      {demo && <StatusChip tone="info" label="Demo data" title="Sample devices. Remove ?demo from the address to see live data." />}
      {identity?.auth && (
        <Button href="/auth/logout" startIcon={<LogoutOutlined />} title={identity.email || undefined}>
          Sign out {identity.name || identity.email || ""}
        </Button>
      )}
      <Button variant="outlined" startIcon={<RefreshOutlined />} onClick={() => { void server.refresh(); void refreshManagement(); }} disabled={server.refreshing}>
        {server.refreshing ? "Refreshing…" : "Refresh"}
      </Button>
    </>
  );

  return (
    <AppShell
      product="NetViz"
      tagline="Network inventory"
      nav={nav}
      active={workspace}
      onNavigate={(id) => setWorkspace(id as "network" | "probes")}
      footer={
        <Typography variant="caption" color="text.secondary">
          {server.state ? `Server ${server.state.version}` : "Connecting to the server"}
          <br />
          Refreshes every {REFRESH_MS / 1000} seconds
        </Typography>
      }
    >
      <WorkspaceBoundary name={workspace === "network" ? "Network" : "Probes"}>
        {workspace === "network" ? (
          <NetworkPage
            key={selectedProbeId}
            server={server}
            freshness={freshness}
            actions={(
              <>
                {!!managed?.probes.length && (
                  <TextField select size="small" label="Site and probe" value={selectedProbeId}
                    onChange={(event) => setProbeId(event.target.value)} sx={{ minWidth: 180 }}>
                    <MenuItem value="legacy">Legacy feed</MenuItem>
                    {managed.probes.map((row) => <MenuItem key={row.id} value={row.id}>{row.site} · {row.name}</MenuItem>)}
                  </TextField>
                )}
                {actions}
              </>
            )}
            view={view}
            onViewChange={setView}
            search={search}
            onSearchChange={setSearch}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            onSetUpProbe={() => setWorkspace("probes")}
          />
        ) : (
          <ProbesPage server={server} freshness={freshness} actions={actions} managed={managed} onChanged={refreshManagement} error={managementError} />
        )}
      </WorkspaceBoundary>
    </AppShell>
  );
}

type Server = ReturnType<typeof useServerState>;
type Freshness = ReturnType<typeof probeFreshness>;

function NetworkPage({
  server,
  freshness,
  actions,
  view,
  onViewChange,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onSetUpProbe,
}: {
  server: Server;
  freshness: Freshness;
  actions: React.ReactNode;
  view: "devices" | "map";
  onViewChange: (view: "devices" | "map") => void;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  onSetUpProbe: () => void;
}) {
  const theme = useTheme();
  // Details sit beside the content from tablet width up (narrower below 1200px)
  // so they never cover the views' own controls; phones get a modal drawer.
  const wide = useMediaQuery(theme.breakpoints.up("md"));
  const roomy = useMediaQuery(theme.breakpoints.up("lg"));
  const [selectedIP, setSelectedIP] = useState("");
  const devices = useMemo(() => [...(server.state?.devices ?? [])].sort((a, b) => compareIP(a.ip, b.ip)), [server.state]);
  const cidr = server.state?.run?.cidr || server.state?.probe?.cidr || "";
  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () => devices.filter((device) => (statusFilter === "all" || (statusFilter === "up" ? device.alive : !device.alive)) && hostMatchesFilter(device, undefined, needle)),
    [devices, statusFilter, needle],
  );
  const matches = useMemo(() => (needle || statusFilter !== "all" ? new Set(filtered.map((device) => device.ip)) : null), [needle, statusFilter, filtered]);
  const selected = devices.find((device) => device.ip === selectedIP);
  const up = devices.filter((device) => device.alive).length;
  const openPorts = devices.reduce((sum, device) => sum + device.open_ports.length, 0);
  const filtersOn = Boolean(needle) || statusFilter !== "all";

  const detail = selected && <DeviceDetail host={selected} onClose={() => setSelectedIP("")} />;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <PageHeader
        title="Network"
        subtitle={`The latest devices your probe reported${cidr ? ` for ${cidr}` : ""}${server.refreshedAt ? ` · updated ${server.refreshedAt.toLocaleTimeString()}` : ""}.`}
        status={server.load.status === "ready" ? <StatusChip tone={freshness.tone} label={freshness.label} /> : undefined}
        actions={actions}
      />
      {server.load.status === "loading" && <LinearProgress aria-label="Loading the inventory" />}
      {server.error && (
        <Box sx={{ px: { xs: 2, sm: 3 }, pt: 2 }}>
          <ErrorNotice error={{ ...server.error, lead: `${server.error.lead}${server.state ? " Showing the last data received." : ""}` }} />
        </Box>
      )}
      {server.load.status === "ready" && devices.length === 0 ? (
        <Box sx={{ flex: 1, display: "grid", placeItems: "center" }}>
          <EmptyState
            icon={SensorsOutlined}
            title={server.state ? "No devices reported yet" : "Can't reach the server yet"}
            action={
              <Stack direction="row" spacing={1} sx={{ justifyContent: "center" }}>
                <Button variant="contained" onClick={onSetUpProbe}>
                  Connect a probe
                </Button>
                <Button href="?demo">See sample data</Button>
              </Stack>
            }
          >
            Devices appear here after a probe finishes its first scan and reports to this server.
          </EmptyState>
        </Box>
      ) : (
        server.load.status === "ready" && (
          <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
            <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", px: { xs: 2, sm: 3 }, py: 1.5 }}>
                <ToggleButtonGroup exclusive value={view} onChange={(_, value) => value && onViewChange(value)} aria-label="Network view">
                  <ToggleButton value="devices" sx={{ px: 1.5, gap: 0.75 }}>
                    <TableRowsOutlined fontSize="small" />
                    Devices
                  </ToggleButton>
                  <ToggleButton value="map" sx={{ px: 1.5, gap: 0.75 }}>
                    <HubOutlined fontSize="small" />
                    Map
                  </ToggleButton>
                </ToggleButtonGroup>
                <TextField
                  type="search"
                  placeholder="Search devices"
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                  sx={{ flex: "1 1 200px", maxWidth: 340 }}
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
                <TextField select label="Status" value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)} sx={{ width: 140 }}>
                  <MenuItem value="all">All devices</MenuItem>
                  <MenuItem value="up">Up</MenuItem>
                  <MenuItem value="down">Down</MenuItem>
                </TextField>
                <Typography variant="body2" color="text.secondary" sx={{ ml: { md: "auto" } }} role="status">
                  {filtersOn ? `${filtered.length} of ${devices.length} devices` : `${devices.length} devices`} · {up} up · {openPorts} open ports
                </Typography>
              </Stack>
              {filtersOn && filtered.length === 0 ? (
                <EmptyState
                  icon={SearchOffOutlined}
                  title="No matching devices"
                  compact
                  action={
                    <Button
                      onClick={() => {
                        onSearchChange("");
                        onStatusFilterChange("all");
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                >
                  Nothing matches the current search and status.
                </EmptyState>
              ) : view === "devices" ? (
                <DeviceTable hosts={filtered} columns={SERVER_COLUMNS} selectedIP={selectedIP} onSelect={setSelectedIP} label="Latest device inventory" empty={null} />
              ) : (
                <Topology hosts={devices} selectedIP={selectedIP} onSelect={setSelectedIP} matches={matches} />
              )}
            </Box>
            {wide && detail && (
              <Paper square sx={{ width: roomy ? 360 : 300, flexShrink: 0, borderTop: 0, borderBottom: 0, borderRight: 0 }}>
                {detail}
              </Paper>
            )}
          </Box>
        )
      )}
      {!wide && (
        <Drawer anchor="right" open={Boolean(detail)} onClose={() => setSelectedIP("")} slotProps={{ paper: { sx: { width: 340, maxWidth: "100%" } } }}>
          {detail}
        </Drawer>
      )}
    </Box>
  );
}

function ProbesPage({ server, freshness, actions, managed, onChanged, error }: {
  server: Server;
  freshness: Freshness;
  actions: React.ReactNode;
  managed: ManagedInventory | null;
  onChanged: () => Promise<void>;
  error: string;
}) {
  const toast = useToast();
  const probe = server.state?.probe;
  const command = `netviz-probe -url ${window.location.origin} -key <ingest key> -cidr 192.168.1.0/24`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      toast("Command copied");
    } catch {
      toast("Couldn't reach the clipboard", "warning");
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <PageHeader
        title="Probes"
        subtitle="A probe scans its network on a schedule and reports here. The server never scans anything itself."
        status={server.load.status === "ready" ? <StatusChip tone={freshness.tone} label={freshness.label} /> : undefined}
        actions={actions}
      />
      <Stack spacing={2} sx={{ p: { xs: 2, sm: 3 }, overflow: "auto", maxWidth: 960 }}>
        {server.error && (
          <ErrorNotice error={{ ...server.error, lead: `${server.error.lead}${probe ? " The probe details below may be out of date." : ""}` }} />
        )}
        {error && <Typography color="error">{error}</Typography>}
        {managed && <ManagedProbes inventory={managed} onChanged={onChanged} />}
        {!managed?.probes.length && probe && (
          <Paper component="section" aria-labelledby="probe-heading" sx={{ p: 2 }}>
            <Typography id="probe-heading" variant="h2" sx={{ mb: 1.5 }}>
              Connected probe
            </Typography>
            <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 2, rowGap: 0.75 }}>
              {[
                ["Last heartbeat", new Date(probe.last_seen).toLocaleString()],
                ["Network", probe.cidr || "Not reported"],
                ["Version", probe.version || "Not reported"],
              ].map(([label, value]) => (
                <Box key={label} sx={{ display: "contents" }}>
                  <Typography component="dt" variant="body2" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              A heartbeat means the probe is reporting. Device updates arrive after each of its scans.
            </Typography>
          </Paper>
        )}
        {!managed && !error && <Paper component="section" aria-labelledby="connect-heading" sx={{ p: 2 }}>
          <Typography id="connect-heading" variant="h2" sx={{ mb: 1 }}>
            {probe ? "Connect another network" : "Connect a probe"}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Run netviz-probe on a machine inside the network you want to see. It reports to this server after its first scan.
          </Typography>
          <Box
            component="pre"
            sx={{ m: 0, p: 1.5, borderRadius: 1, bgcolor: "action.hover", fontFamily: monoFont, fontSize: 12.5, whiteSpace: "pre-wrap", wordBreak: "break-all" }}
          >
            {command}
          </Box>
          <Button startIcon={<ContentCopyOutlined />} onClick={() => void copy()} sx={{ mt: 1 }}>
            Copy command
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            The ingest key is set on the server with <code>-ingest-key</code> or the <code>NETVIZ_INGEST_KEY</code> environment variable. The desktop app can install the probe as a
            service for you. Curious first? <Link href="?demo">Open sample data</Link>.
          </Typography>
        </Paper>}
      </Stack>
    </Box>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <NetvizRoot>
      <App />
    </NetvizRoot>
  </React.StrictMode>,
);
