import { useRef, useState } from "react";
import Typography from "@mui/material/Typography";
import HubOutlined from "@mui/icons-material/HubOutlined";
import HistoryOutlined from "@mui/icons-material/HistoryOutlined";
import SensorsOutlined from "@mui/icons-material/SensorsOutlined";
import SettingsOutlined from "@mui/icons-material/SettingsOutlined";
import { AppShell, WorkspaceBoundary, type NavItem } from "@netviz/ui";
import { useScan } from "./state/useScan";
import { useHistoryRuns } from "./state/useHistoryRuns";
import { useProbe } from "./state/useProbe";
import { useUpdates } from "./state/useUpdates";
import { NetworkWorkspace, type NetworkView } from "./workspaces/network/NetworkWorkspace";
import { HistoryWorkspace } from "./workspaces/HistoryWorkspace";
import { ProbeWorkspace } from "./workspaces/ProbeWorkspace";
import { SettingsWorkspace } from "./workspaces/SettingsWorkspace";

type Workspace = "network" | "history" | "probe" | "settings";

const NAMES: Record<Workspace, string> = { network: "Network", history: "History", probe: "Probe", settings: "Settings" };

export function App() {
  const scan = useScan();
  const history = useHistoryRuns();
  const probe = useProbe(scan.cidr);
  const updates = useUpdates();
  const [workspace, setWorkspace] = useState<Workspace>("network");
  // The network view and search live here so they survive leaving the
  // Network workspace and coming back.
  const [view, setView] = useState<NetworkView>("devices");
  const [search, setSearch] = useState("");
  const portsRef = useRef<HTMLElement | null>(null);

  const nav: NavItem[] = [
    { id: "network", label: "Network", description: "Scan and inspect devices", icon: HubOutlined },
    { id: "history", label: "History", description: "Compare saved scans", icon: HistoryOutlined },
    { id: "probe", label: "Probe", description: "Report continuously", icon: SensorsOutlined },
  ];
  const footerNav: NavItem[] = [
    {
      id: "settings",
      label: "Settings",
      description: updates.info.available ? `Update ${updates.info.latest_version} available` : "Ports, theme, updates",
      icon: SettingsOutlined,
      badge: updates.info.available,
      badgeLabel: "Update available",
    },
  ];

  function openPorts() {
    setWorkspace("settings");
    window.setTimeout(() => {
      portsRef.current?.scrollIntoView({ block: "start" });
      portsRef.current?.focus({ preventScroll: true });
    }, 50);
  }

  return (
    <AppShell
      product="NetViz"
      tagline="Network discovery"
      nav={nav}
      footerNav={footerNav}
      footer={
        <Typography variant="caption" color="text.secondary">
          Scans stay on this PC.
        </Typography>
      }
      active={workspace}
      onNavigate={(id) => setWorkspace(id as Workspace)}
    >
      <WorkspaceBoundary name={NAMES[workspace]}>
        {workspace === "network" && (
          <NetworkWorkspace scan={scan} view={view} onViewChange={setView} search={search} onSearchChange={setSearch} onOpenPorts={openPorts} />
        )}
        {workspace === "history" && <HistoryWorkspace history={history} onGoToNetwork={() => setWorkspace("network")} />}
        {workspace === "probe" && <ProbeWorkspace probe={probe} />}
        {workspace === "settings" && <SettingsWorkspace scan={scan} updates={updates} portsRef={portsRef} />}
      </WorkspaceBoundary>
    </AppShell>
  );
}
