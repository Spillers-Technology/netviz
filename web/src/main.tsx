import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { Device, ProbeStatus, ServerState } from "./types";
import NetworkMap from "./NetworkMap";
import { demoState } from "./demo";

const REFRESH_MS = 10000;
const PROBE_STALE_MS = 5 * 60 * 1000;

function App() {
  const demo = useMemo(() => new URLSearchParams(window.location.search).has("demo"), []);
  const [state, setState] = useState<ServerState | null>(null);
  const [view, setView] = useState<"devices" | "map" | "probe">("devices");
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [identity, setIdentity] = useState<{ auth: boolean; email?: string; name?: string } | null>(null);

  useEffect(() => {
    if (demo) return;
    fetch("/api/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((me) => setIdentity(me))
      .catch(() => {});
  }, [demo]);

  async function refresh() {
    if (demo) {
      setState(demoState());
      setRefreshedAt(new Date());
      return;
    }
    setRefreshing(true);
    try {
      const response = await fetch("/api/state");
      if (!response.ok) throw new Error(`state request failed with status ${response.status}`);
      setState((await response.json()) as ServerState);
      setRefreshedAt(new Date());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const devices = state?.devices ?? [];
  const upCount = devices.filter((device) => device.alive).length;
  const openPortCount = devices.reduce((sum, device) => sum + device.open_ports.length, 0);
  const cidr = state?.run?.cidr || state?.probe?.cidr || "";

  const filteredDevices = devices.filter((device) => {
    const needle = filter.trim().toLowerCase();
    return (statusFilter === "all" || (statusFilter === "up" ? device.alive : !device.alive)) &&
      [device.ip, device.hostname, device.mac_address, device.vendor, device.device_type, ...device.open_ports.map((port) => `${port.port} ${port.service}`)].join(" ").toLowerCase().includes(needle);
  });

  return (
    <main className="shell appShell">
      <aside className="appSidebar"><div className="brand">NetViz<span>Network inventory</span></div>
        <nav className="workspaceNav" aria-label="Workspaces"><button className={view !== "probe" ? "active" : ""} aria-current={view !== "probe" ? "page" : undefined} onClick={() => setView("devices")}>Network<span>Inspect the latest inventory</span></button><button className={view === "probe" ? "active" : ""} aria-current={view === "probe" ? "page" : undefined} onClick={() => setView("probe")}>Probe<span>Reporting and connection</span></button></nav>
        <div className="sidebarFoot"><span>{state ? `Server ${state.version}` : "Connecting to server"}</span><span>Inventory refreshes every 10 seconds</span></div>
      </aside>
      <div className="workspaceContent">
      <header className="topBar">
        <div>
          <p className="eyebrow">Server workspace{cidr ? ` · ${cidr}` : ""}</p><h1>{view === "probe" ? "Continuous reporting" : "Your network"}</h1>
          <p className="quiet">
            {state ? `netviz-server ${state.version}` : "connecting"}
            {refreshedAt ? ` · refreshed ${refreshedAt.toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="topActions">
          <ProbeBadge probe={state?.probe} />
          {identity?.auth && (
            <span className="identity">
              {identity.name || identity.email || "signed in"} · <a href="/auth/logout">sign out</a>
            </span>
          )}
          <button disabled={refreshing} onClick={() => void refresh()}>{refreshing ? "Refreshing…" : "Refresh"}</button>
        </div>
      </header>

      {demo && (
        <div className="demoBanner">
          Demo data — remove <code>?demo</code> from the URL to see live state.
        </div>
      )}
      {error && <div className="error" role="alert">Could not refresh inventory. {state ? "Showing the last received data. " : ""}{error}</div>}

      <section className="tiles" aria-label="Network summary">
        <StatTile label="Devices" value={devices.length} />
        <StatTile label="Up" value={upCount} />
        <StatTile label="Open ports" value={openPortCount} />
        <StatTile
          label="Last push"
          value={state?.run ? new Date(state.run.ended_at || state.run.started_at).toLocaleTimeString() : "—"}
          detail={state?.run ? state.run.cidr : "no runs stored"}
        />
      </section>

      {view === "probe" ? <section className="probeOverview"><h2>Probe connection</h2><ProbeBadge probe={state?.probe} /><p className="quiet">{state?.probe ? `Last heartbeat: ${formatTime(state.probe.last_seen)}. A heartbeat confirms the probe is reporting; device observations come from its scan cycles.` : "Waiting for the first heartbeat. Connect a probe to begin receiving observations."}</p><EmptyState connected={Boolean(state)} setup /></section> : <>
        <div className="networkTools"><nav className="tabs" aria-label="Network views"><button aria-pressed={view === "devices"} className={view === "devices" ? "active" : ""} onClick={() => setView("devices")}>Devices</button><button aria-pressed={view === "map"} className={view === "map" ? "active" : ""} onClick={() => setView("map")}>Map</button></nav>
        <label className="searchField"><span>Find a device</span><input type="search" placeholder="IP, name, vendor, or port" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
        <label className="searchField"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All devices</option><option value="up">Up</option><option value="down">Down</option></select></label></div>
        {devices.length > 0 ? <><p className="quiet">{filteredDevices.length} of {devices.length} devices · latest received observations{refreshedAt ? ` · checked ${refreshedAt.toLocaleTimeString()}` : ""}</p>{filteredDevices.length === 0 ? <section className="emptyState"><h2>No matching devices</h2><button onClick={() => { setFilter(""); setStatusFilter("all"); }}>Clear filters</button></section> : view === "map" ? <NetworkMap devices={filteredDevices} cidr={cidr} /> : <section className="tableWrap" aria-label="Latest device inventory"><DeviceTable devices={filteredDevices} /></section>}</> : <section className="tableWrap"><EmptyState connected={Boolean(state)} /></section>}
      </>}
      </div>
    </main>
  );
}

type SortKey = "ip" | "hostname" | "mac" | "vendor" | "status" | "ports" | "type" | "last_seen";

const DEVICE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "ip", label: "IP" },
  { key: "hostname", label: "Hostname" },
  { key: "mac", label: "MAC" },
  { key: "vendor", label: "Vendor" },
  { key: "status", label: "Status" },
  { key: "ports", label: "Open ports" },
  { key: "type", label: "Device type" },
  { key: "last_seen", label: "Last seen" },
];

// textCompare sorts case-insensitively with blanks last, matching the
// desktop table's behavior.
function textCompare(a: string, b: string) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function compareIP(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 4; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function compareDevices(a: Device, b: Device, key: SortKey) {
  switch (key) {
    case "hostname":
      return textCompare(a.hostname || "", b.hostname || "");
    case "mac":
      return textCompare(a.mac_address || "", b.mac_address || "");
    case "vendor":
      return textCompare(a.vendor || "", b.vendor || "");
    case "status":
      return (b.alive ? 1 : 0) - (a.alive ? 1 : 0);
    case "ports":
      return b.open_ports.length - a.open_ports.length;
    case "type":
      return textCompare(a.device_type, b.device_type);
    case "last_seen":
      return Date.parse(a.last_updated || "") - Date.parse(b.last_updated || "");
    default:
      return 0;
  }
}

function DeviceTable({ devices }: { devices: Device[] }) {
  const filter = "";
  const [sortKey, setSortKey] = useState<SortKey>("ip");
  const [sortAsc, setSortAsc] = useState(true);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? devices.filter((device) =>
          [
            device.ip,
            device.hostname || "",
            device.mac_address || "",
            device.vendor || "",
            device.device_type,
            device.alive ? "up" : "down",
            device.open_ports.map((port) => `${port.port} ${port.service}`).join(" "),
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        )
      : devices;
    return [...filtered].sort((a, b) => {
      const order = compareDevices(a, b, sortKey) || compareIP(a.ip, b.ip);
      return sortAsc ? order : -order;
    });
  }, [devices, filter, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortAsc((asc) => !asc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  return (
    <>
      <table>
        <thead>
          <tr>
            {DEVICE_COLUMNS.map((column) => (
              <th key={column.key} aria-sort={sortKey === column.key ? (sortAsc ? "ascending" : "descending") : undefined}>
                <button type="button" className="sortHeader" onClick={() => toggleSort(column.key)}>
                  {column.label}
                  {sortKey === column.key && <span className="sortArrow" aria-hidden="true">{sortAsc ? "▲" : "▼"}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((device) => (
            <tr key={device.ip}>
              <td>{device.ip}</td>
              <td>{device.hostname || ""}</td>
              <td>{device.mac_address || ""}</td>
              <td>{device.vendor || ""}</td>
              <td>
                <span className={`statusPill ${device.alive ? "up" : "down"}`}>
                  {device.alive ? "up" : "down"}
                </span>
              </td>
              <td>{device.open_ports.map((port) => port.port).join(", ")}</td>
              <td>{device.device_type}</td>
              <td>{formatTime(device.last_updated)}</td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td className="empty" colSpan={8}>
                No devices match the filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

function StatTile({ label, value, detail }: { label: string; value: number | string; detail?: string }) {
  return (
    <div className="tile">
      <span className="tileLabel">{label}</span>
      <strong className="tileValue">{value}</strong>
      {detail && <span className="tileDetail">{detail}</span>}
    </div>
  );
}

function ProbeBadge({ probe }: { probe?: ProbeStatus }) {
  if (!probe) {
    return <span className="probeBadge none">no probe heartbeat yet</span>;
  }
  const ageMs = Date.now() - new Date(probe.last_seen).getTime();
  const stale = ageMs > PROBE_STALE_MS;
  return (
    <span className={`probeBadge ${stale ? "stale" : "fresh"}`}>
      probe {stale ? "stale" : "online"} · seen {formatAge(ageMs)} ago
      {probe.cidr ? ` · ${probe.cidr}` : ""}
    </span>
  );
}

function EmptyState({ connected, setup = false }: { connected: boolean; setup?: boolean }) {
  return (
    <div className="emptyState">
      <h2>{setup ? "Connect a probe" : connected ? "No device pushes yet" : "Connecting to server"}</h2>
      <p>
        Point a probe at this server and it will appear here after its first
        scan cycle:
      </p>
      <pre>netviz-probe -url http://&lt;this-host&gt;:8080 -key &lt;ingest key&gt; -cidr 192.168.1.0/24</pre>
      <p className="quiet">
        The ingest key is set on the server with <code>-ingest-key</code> or the
        <code> NETVIZ_INGEST_KEY</code> environment variable. Curious what the
        map looks like? Open <a href="?demo">?demo</a> for sample data.
      </p>
    </div>
  );
}

function formatTime(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function formatAge(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
