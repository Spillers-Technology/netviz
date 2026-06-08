import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type PortObservation = {
  port: number;
  service: string;
};

type HostObservation = {
  ip: string;
  hostname?: string;
  mac_address?: string;
  vendor?: string;
  alive: boolean;
  open_ports: PortObservation[];
  device_type: string;
  first_seen: string;
  last_updated: string;
};

type ScanRun = {
  id: string;
  cidr: string;
  started_at: string;
  ended_at?: string;
  host_count: number;
  alive_count: number;
  open_port_count: number;
};

type HostChange = {
  ip: string;
  before: HostObservation;
  after: HostObservation;
  hostname_changed: boolean;
  mac_changed: boolean;
  vendor_changed: boolean;
  ports_changed: boolean;
  device_type_changed: boolean;
};

type ScanDiff = {
  base_run_id: string;
  compare_run_id: string;
  new_hosts?: HostObservation[];
  missing_hosts?: HostObservation[];
  changed_hosts?: HostChange[];
};

type ScanEvent = {
  type: string;
  ip?: string;
  host?: HostObservation;
  checked_hosts?: number;
  total_hosts?: number;
};

type Tab = "table" | "graph" | "hierarchy" | "history";
type DeviceState = "new" | "online" | "offline" | "changed" | "stable";

declare global {
  interface Window {
    go?: {
      main?: {
        App?: {
          StartScan(cidr: string): Promise<void>;
          StartMonitorScan(cidr: string): Promise<void>;
          CancelScan(): Promise<void>;
          SaveScanFile(): Promise<void>;
          OpenScanFile(): Promise<HostObservation[] | null>;
          SaveCSVFile(): Promise<void>;
          ListHistory(): Promise<ScanRun[]>;
          LatestDiff(): Promise<ScanDiff>;
        };
      };
    };
    runtime?: {
      EventsOn(name: string, callback: (payload: unknown) => void): (() => void) | void;
    };
  }
}

function App() {
  const [cidr, setCidr] = useState("192.168.1.0/24");
  const [hosts, setHosts] = useState<Record<string, HostObservation>>({});
  const [deviceStates, setDeviceStates] = useState<Record<string, DeviceState>>({});
  const [history, setHistory] = useState<ScanRun[]>([]);
  const [diff, setDiff] = useState<ScanDiff>({ base_run_id: "", compare_run_id: "" });
  const [tab, setTab] = useState<Tab>("table");
  const [scanning, setScanning] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [showCheckedOnly, setShowCheckedOnly] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [checkedHosts, setCheckedHosts] = useState(0);
  const [totalHosts, setTotalHosts] = useState(0);
  const [error, setError] = useState("");
  const monitoringRef = useRef(false);
  const scanningRef = useRef(false);
  const cidrRef = useRef(cidr);

  useEffect(() => {
    monitoringRef.current = monitoring;
  }, [monitoring]);

  useEffect(() => {
    scanningRef.current = scanning;
  }, [scanning]);

  useEffect(() => {
    cidrRef.current = cidr;
  }, [cidr]);

  useEffect(() => {
    refreshHistory();
    const offEvent = window.runtime?.EventsOn("scan:event", (payload) => {
      const event = payload as ScanEvent;
      if (event.host) {
        applyHostEvent(event);
      }
      if (event.checked_hosts !== undefined) {
        setCheckedHosts(event.checked_hosts);
      }
      if (event.total_hosts !== undefined) {
        setTotalHosts(event.total_hosts);
      }
      if (event.type === "scan_finished") {
        setScanning(false);
        scanningRef.current = false;
      }
    });
    const offState = window.runtime?.EventsOn("scan:state", (payload) => {
      const state = payload as { scanning?: boolean };
      if (typeof state.scanning === "boolean") {
        setScanning(state.scanning);
        scanningRef.current = state.scanning;
      }
    });
    const offHistory = window.runtime?.EventsOn("history:updated", () => {
      refreshHistory();
    });
    const offHistoryError = window.runtime?.EventsOn("history:error", (payload) => {
      setError(String(payload));
    });
    const offLoaded = window.runtime?.EventsOn("scan:loaded", (payload) => {
      loadHosts((payload as HostObservation[]) || []);
    });
    return () => {
      if (typeof offEvent === "function") offEvent();
      if (typeof offState === "function") offState();
      if (typeof offHistory === "function") offHistory();
      if (typeof offHistoryError === "function") offHistoryError();
      if (typeof offLoaded === "function") offLoaded();
    };
  }, []);

  const rows = useMemo(() => {
    return Object.values(hosts).sort((a, b) => compareIP(a.ip, b.ip));
  }, [hosts]);

  const visibleRows = useMemo(() => {
    return rows.filter((host) => shouldShowHost(host, deviceStates[host.ip], showCheckedOnly));
  }, [rows, deviceStates, showCheckedOnly]);

  const aliveRows = rows.filter((host) => host.alive);
  const openPortsFound = rows.reduce((sum, host) => sum + host.open_ports.length, 0);
  const offlineCount = Object.values(deviceStates).filter((state) => state === "offline").length;
  const hiddenCheckedOnly = rows.length - visibleRows.length;

  useEffect(() => {
    if (!monitoring || scanning) return;
    const timer = window.setTimeout(() => {
      void startScan(true, true);
    }, rows.length === 0 ? 100 : 15000);
    return () => window.clearTimeout(timer);
  }, [monitoring, scanning, rows.length]);

  async function refreshHistory() {
    const app = window.go?.main?.App;
    if (!app) return;
    try {
      const [runs, latestDiff] = await Promise.all([app.ListHistory(), app.LatestDiff()]);
      setHistory(runs || []);
      setDiff(latestDiff || { base_run_id: "", compare_run_id: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function applyHostEvent(event: ScanEvent) {
    if (!event.host) return;
    const incoming = event.host;
    setHosts((current) => {
      const previous = current[incoming.ip];
      if (monitoringRef.current && event.type === "host_seen" && previous) {
        return current;
      }

      const nextHost = incoming;
      const next = { ...current, [nextHost.ip]: nextHost };
      if (event.type === "host_done" || event.type === "host_enriched" || event.type === "port_open" || event.type === "device_classified") {
        const state = classifyTransition(previous, nextHost);
        setDeviceStates((states) => ({ ...states, [nextHost.ip]: state }));
      }
      return next;
    });
  }

  function loadHosts(opened: HostObservation[]) {
    const nextHosts: Record<string, HostObservation> = {};
    for (const host of opened) {
      nextHosts[host.ip] = host;
    }
    setHosts(nextHosts);
    setDeviceStates({});
    setCheckedHosts(0);
    setTotalHosts(opened.length);
  }

  async function startScan(preserve = false, fromMonitor = false) {
    setError("");
    if (!preserve) {
      setHosts({});
      setDeviceStates({});
    }
    setCheckedHosts(0);
    setTotalHosts(0);
    try {
      if (preserve) {
        await window.go?.main?.App?.StartMonitorScan(cidrRef.current);
      } else {
        await window.go?.main?.App?.StartScan(cidrRef.current);
      }
      setScanning(true);
      scanningRef.current = true;
    } catch (err) {
      setScanning(false);
      scanningRef.current = false;
      if (fromMonitor && !monitoringRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelScan() {
    setMonitoring(false);
    await window.go?.main?.App?.CancelScan();
  }

  async function toggleMonitor() {
    const next = !monitoring;
    setMonitoring(next);
    monitoringRef.current = next;
    if (next && !scanningRef.current) {
      await startScan(rows.length > 0, true);
    }
  }

  async function saveScan() {
    const app = window.go?.main?.App;
    if (!app) return;
    setError("");
    setFileOpen(false);
    try {
      await app.SaveScanFile();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openScan() {
    const app = window.go?.main?.App;
    if (!app) return;
    setError("");
    setFileOpen(false);
    try {
      const opened = await app.OpenScanFile();
      if (!opened) return;
      loadHosts(opened);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveCSV() {
    const app = window.go?.main?.App;
    if (!app) return;
    setError("");
    setFileOpen(false);
    try {
      await app.SaveCSVFile();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="shell">
      <section className="toolbar" aria-label="Scan controls">
        <div className="fileMenu">
          <button onClick={() => setFileOpen((open) => !open)}>File</button>
          {fileOpen && (
            <div className="fileMenuList">
              <button onClick={openScan}>Open Scan</button>
              <button onClick={saveScan} disabled={rows.length === 0}>Save Scan</button>
              <button onClick={saveCSV} disabled={rows.length === 0}>Save CSV</button>
            </div>
          )}
        </div>
        <label className="field">
          <span>CIDR</span>
          <input value={cidr} onChange={(event) => setCidr(event.target.value)} disabled={scanning} />
        </label>
        <button className="primary" onClick={() => startScan(false)} disabled={scanning}>
          Start Scan
        </button>
        <button onClick={toggleMonitor}>
          {monitoring ? "Stop Monitor" : "Monitor"}
        </button>
        <button onClick={cancelScan} disabled={!scanning}>
          Cancel
        </button>
        <label className="toggle compact">
          <input type="checkbox" checked={showCheckedOnly} onChange={(event) => setShowCheckedOnly(event.target.checked)} />
          <span>Show checked-only</span>
        </label>
      </section>

      <section className="status" aria-label="Scan status">
        <span>{scanning ? "scanning" : "not scanning"}</span>
        <span>{checkedHosts}/{totalHosts || 0} hosts checked</span>
        <span>{aliveRows.length} alive</span>
        <span>{openPortsFound} open ports</span>
        <span>{offlineCount} offline</span>
        <span>{visibleRows.length} shown</span>
        {hiddenCheckedOnly > 0 && <span>{hiddenCheckedOnly} checked-only hidden</span>}
        {monitoring && <span>monitoring every 15s</span>}
      </section>

      <nav className="tabs" aria-label="Views">
        <button className={tab === "table" ? "active" : ""} onClick={() => setTab("table")}>
          Table
        </button>
        <button className={tab === "graph" ? "active" : ""} onClick={() => setTab("graph")}>
          Graph
        </button>
        <button className={tab === "hierarchy" ? "active" : ""} onClick={() => setTab("hierarchy")}>
          Hierarchy
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          History
        </button>
      </nav>

      {error && <div className="error">{error}</div>}

      {tab === "table" && <TableView rows={visibleRows} states={deviceStates} hiddenCount={hiddenCheckedOnly} />}
      {tab === "graph" && <GraphView hosts={visibleRows} states={deviceStates} />}
      {tab === "hierarchy" && <HierarchyView hosts={visibleRows} states={deviceStates} />}
      {tab === "history" && <HistoryView history={history} diff={diff} onRefresh={refreshHistory} />}
    </main>
  );
}

function TableView({ rows, states, hiddenCount }: { rows: HostObservation[]; states: Record<string, DeviceState>; hiddenCount: number }) {
  return (
    <section className="tableWrap" aria-label="Scan results">
      <table>
        <thead>
          <tr>
            <th>IP</th>
            <th>Hostname</th>
            <th>MAC</th>
            <th>Vendor</th>
            <th>State</th>
            <th>Alive</th>
            <th>Open ports</th>
            <th>Guessed device type</th>
            <th>First seen</th>
            <th>Last updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((host) => (
            <tr key={host.ip}>
              <td>{host.ip}</td>
              <td>{host.hostname || ""}</td>
              <td>{host.mac_address || ""}</td>
              <td>{host.vendor || ""}</td>
              <td><StatePill state={states[host.ip] || "stable"} /></td>
              <td>{host.alive ? "yes" : "no"}</td>
              <td>{formatPorts(host.open_ports)}</td>
              <td>{host.device_type}</td>
              <td>{formatTime(host.first_seen)}</td>
              <td>{formatTime(host.last_updated)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty" colSpan={10}>
                {hiddenCount > 0 ? `${hiddenCount} checked-only hosts hidden.` : "No scan results yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function GraphView({ hosts, states }: { hosts: HostObservation[]; states: Record<string, DeviceState> }) {
  const [selectedIP, setSelectedIP] = useState("");
  const groups = groupHosts(hosts);
  const discovered = hosts.length;
  const withPorts = hosts.filter((host) => host.open_ports.length > 0).length;
  const selected =
    hosts.find((host) => host.ip === selectedIP) ||
    hosts.find((host) => host.open_ports.length > 0) ||
    hosts[0];

  useEffect(() => {
    if (selectedIP && hosts.some((host) => host.ip === selectedIP)) return;
    setSelectedIP(hosts.find((host) => host.open_ports.length > 0)?.ip || hosts[0]?.ip || "");
  }, [hosts, selectedIP]);

  return (
    <section className="graphWrap" aria-label="Network graph">
      <div className="networkMap">
        <div className="graphRoot">
          <div className="rootNode">Firewall</div>
          <div className="graphMeta">
            <span>{discovered} checked</span>
            <span>{withPorts} with open ports</span>
          </div>
        </div>

        <div className="graphGroups">
          {groups.map((group) => (
            <section className="graphGroup" key={group.name}>
              <div className="groupHeader">
                <span>{group.name}</span>
                <strong>{group.hosts.length}</strong>
              </div>
              <div className="nodeGrid">
                {group.hosts.map((host) => (
                  <button
                    className={`deviceNode ${host.alive ? "" : "quietNode"} ${stateClass(states[host.ip])} ${selected?.ip === host.ip ? "selected" : ""}`}
                    key={host.ip}
                    type="button"
                    onClick={() => setSelectedIP(host.ip)}
                  >
                    <div className="deviceTitle">{host.hostname || host.vendor || host.ip}</div>
                    <div className="deviceIP">{host.ip}</div>
                    <div className="deviceState">{nodeState(host, states[host.ip])}</div>
                    <div className="badges">
                      {host.open_ports.slice(0, 6).map((port) => (
                        <span key={`${host.ip}-${port.port}`} title={port.service}>{port.port}</span>
                      ))}
                      {host.open_ports.length > 6 && <span>+{host.open_ports.length - 6}</span>}
                    </div>
                  </button>
                ))}
                {group.hosts.length === 0 && <div className="emptyGroup">No devices</div>}
              </div>
            </section>
          ))}
        </div>
      </div>

      <DeviceDetail host={selected} state={selected ? states[selected.ip] : undefined} />
    </section>
  );
}

function HierarchyView({ hosts, states }: { hosts: HostObservation[]; states: Record<string, DeviceState> }) {
  const [selectedIP, setSelectedIP] = useState("");
  const selected =
    hosts.find((host) => host.ip === selectedIP) ||
    hosts.find((host) => host.open_ports.length > 0) ||
    hosts[0];
  const layout = useMemo(() => hierarchyLayout(hosts), [hosts]);

  useEffect(() => {
    if (selectedIP && hosts.some((host) => host.ip === selectedIP)) return;
    setSelectedIP(hosts.find((host) => host.open_ports.length > 0)?.ip || hosts[0]?.ip || "");
  }, [hosts, selectedIP]);

  return (
    <section className="hierarchyWrap" aria-label="Hierarchy node graph">
      <div className="hierarchyCanvas">
        <div className="hierarchyToolbar">
          <div>
            <strong>Firewall hierarchy</strong>
            <span>{hosts.length} shown</span>
          </div>
        </div>

        <div className="radialMap">
          <svg className="edges" viewBox="0 0 1000 620" role="presentation" aria-hidden="true">
            {layout.map((item) => (
              <line key={`edge-${item.host.ip}`} x1="500" y1="310" x2={item.x} y2={item.y} />
            ))}
          </svg>
          <button className="firewallNode" type="button">
            <span>Firewall</span>
            <b>{hosts.filter((host) => host.open_ports.length > 0).length}</b>
          </button>
          {layout.map((item) => (
            <button
              key={item.host.ip}
              className={`circleNode ${nodeClass(item.host)} ${stateClass(states[item.host.ip])} ${selected?.ip === item.host.ip ? "selected" : ""}`}
              style={{ left: `${item.x / 10}%`, top: `${item.y / 6.2}%`, width: item.size, height: item.size }}
              type="button"
              title={`${item.host.ip} ${formatPorts(item.host.open_ports)}`}
              onClick={() => setSelectedIP(item.host.ip)}
            >
              <span>{nodeInitial(item.host)}</span>
              {item.host.open_ports.length > 0 && <b>{item.host.open_ports.length}</b>}
            </button>
          ))}
        </div>
      </div>

      <DeviceDetail host={selected} state={selected ? states[selected.ip] : undefined} />
    </section>
  );
}

function HistoryView({ history, diff, onRefresh }: { history: ScanRun[]; diff: ScanDiff; onRefresh: () => void }) {
  const newHosts = diff.new_hosts || [];
  const missingHosts = diff.missing_hosts || [];
  const changedHosts = diff.changed_hosts || [];
  return (
    <section className="historyWrap" aria-label="Scan history">
      <div className="historyHeader">
        <h2>Scan history</h2>
        <button onClick={onRefresh}>Refresh</button>
      </div>
      <div className="historyGrid">
        <section className="historyPanel">
          <h3>Runs</h3>
          {history.map((run) => (
            <article className="runRow" key={run.id}>
              <div>
                <strong>{run.cidr}</strong>
                <span>{new Date(run.started_at).toLocaleString()}</span>
              </div>
              <div className="runStats">
                <span>{run.host_count} hosts</span>
                <span>{run.alive_count} alive</span>
                <span>{run.open_port_count} ports</span>
              </div>
            </article>
          ))}
          {history.length === 0 && <p className="quiet">No saved scan runs yet.</p>}
        </section>

        <section className="historyPanel">
          <h3>Latest diff</h3>
          {history.length < 2 && <p className="quiet">Run two scans to compare history.</p>}
          {history.length >= 2 && (
            <div className="diffColumns">
              <DiffList title="New" hosts={newHosts} />
              <DiffList title="Missing" hosts={missingHosts} />
              <section>
                <h4>Changed</h4>
                {changedHosts.map((change) => (
                  <article className="diffItem" key={change.ip}>
                    <strong>{change.ip}</strong>
                    <span>
                      {change.hostname_changed ? "hostname " : ""}
                      {change.mac_changed ? "mac " : ""}
                      {change.vendor_changed ? "vendor " : ""}
                      {change.ports_changed ? "ports " : ""}
                      {change.device_type_changed ? "type" : ""}
                    </span>
                  </article>
                ))}
                {changedHosts.length === 0 && <p className="quiet">None</p>}
              </section>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function DeviceDetail({ host, state = "stable" }: { host?: HostObservation; state?: DeviceState }) {
  return (
    <aside className="detailPanel" aria-label="Selected device details">
      {host ? (
        <>
          <div className="detailHeader">
            <h2>{host.hostname || host.ip}</h2>
            <div className="detailBadges">
              <span>{host.device_type}</span>
              <StatePill state={state} />
            </div>
          </div>
          <dl className="detailGrid">
            <div>
              <dt>IP</dt>
              <dd>{host.ip}</dd>
            </div>
            <div>
              <dt>Hostname</dt>
              <dd>{host.hostname || "unknown"}</dd>
            </div>
            <div>
              <dt>MAC</dt>
              <dd>{host.mac_address || "unknown"}</dd>
            </div>
            <div>
              <dt>Vendor</dt>
              <dd>{host.vendor || "unknown"}</dd>
            </div>
          </dl>
          <section className="portsPanel">
            <h3>Open ports</h3>
            {host.open_ports.length > 0 ? (
              <div className="portList">
                {host.open_ports.map((port) => (
                  <span key={`${host.ip}-detail-${port.port}`}>
                    <b>{port.port}</b>
                    <em>{port.service}</em>
                  </span>
                ))}
              </div>
            ) : (
              <p>No default scan ports responded.</p>
            )}
          </section>
        </>
      ) : (
        <p className="quiet">Run a scan to select a device.</p>
      )}
    </aside>
  );
}

function DiffList({ title, hosts }: { title: string; hosts: HostObservation[] }) {
  return (
    <section>
      <h4>{title}</h4>
      {hosts.map((host) => (
        <article className="diffItem" key={host.ip}>
          <strong>{host.ip}</strong>
          <span>{host.hostname || host.device_type}</span>
        </article>
      ))}
      {hosts.length === 0 && <p className="quiet">None</p>}
    </section>
  );
}

function StatePill({ state }: { state: DeviceState }) {
  if (state === "stable") return <span className="statePill stable">stable</span>;
  return <span className={`statePill ${state}`}>{state}</span>;
}

function groupHosts(hosts: HostObservation[]) {
  const names = ["firewall/network", "windows/smb", "linux/iot", "apple", "printer", "camera/media", "web appliance", "unknown"];
  const groups = names.map((name) => ({ name, hosts: [] as HostObservation[] }));
  for (const host of hosts) {
    groups.find((group) => group.name === categoryFor(host))!.hosts.push(host);
  }
  return groups;
}

function categoryFor(host: HostObservation) {
  if (!host.alive && host.open_ports.length === 0) return "unknown";
  if (host.open_ports.some((port) => port.port === 53) || host.device_type === "network_device") return "firewall/network";
  if (host.device_type === "windows_or_smb" || host.device_type === "windows_rdp") return "windows/smb";
  if (host.device_type === "ssh_device" || host.device_type === "linux_or_iot" || host.device_type === "iot_device") return "linux/iot";
  if (host.device_type === "apple_device") return "apple";
  if (host.device_type === "printer") return "printer";
  if (host.device_type === "camera_or_rtsp" || host.device_type === "plex") return "camera/media";
  if (host.device_type === "web_device") return "web appliance";
  return "unknown";
}

function nodeState(host: HostObservation, state: DeviceState = "stable") {
  if (state === "offline") return "offline";
  if (state === "online") return "online";
  if (state === "new") return "new";
  if (state === "changed") return "changed";
  if (host.open_ports.length > 0) return `${host.open_ports.length} open port${host.open_ports.length === 1 ? "" : "s"}`;
  if (host.alive) return "alive";
  return "checked";
}

function classifyTransition(previous: HostObservation | undefined, next: HostObservation): DeviceState {
  const previousActive = previous ? hasResponseSignal(previous) : false;
  const nextActive = hasResponseSignal(next);
  if (!previous && nextActive) return "new";
  if (previousActive && !nextActive) return "offline";
  if (!previousActive && nextActive) return "online";
  if (previous && nextActive && hostChanged(previous, next)) return "changed";
  return "stable";
}

function hasResponseSignal(host: HostObservation) {
  return host.alive || host.open_ports.length > 0 || Boolean(host.mac_address);
}

function shouldShowHost(host: HostObservation, state: DeviceState = "stable", showCheckedOnly: boolean) {
  if (showCheckedOnly) return true;
  if (state === "offline" || state === "changed" || state === "new" || state === "online") return true;
  return isVisuallyActive(host);
}

function hostChanged(previous: HostObservation, next: HostObservation) {
  return (
    previous.hostname !== next.hostname ||
    previous.mac_address !== next.mac_address ||
    previous.vendor !== next.vendor ||
    previous.device_type !== next.device_type ||
    formatPorts(previous.open_ports) !== formatPorts(next.open_ports)
  );
}

function stateClass(state: DeviceState = "stable") {
  return `state-${state}`;
}

function isVisuallyActive(host: HostObservation) {
  return host.alive || host.open_ports.length > 0 || Boolean(host.mac_address || host.vendor || host.hostname);
}

function hierarchyLayout(hosts: HostObservation[]) {
  const sorted = [...hosts].sort((a, b) => {
    const score = hostScore(b) - hostScore(a);
    return score !== 0 ? score : compareIP(a.ip, b.ip);
  });
  const centerX = 500;
  const centerY = 310;
  return sorted.map((host, index) => {
    const ringIndex = Math.floor((Math.sqrt(index + 1) - 1) / 1.55);
    const ringStart = Math.max(0, Math.floor((ringIndex * 1.55 + 1) ** 2) - 1);
    const ringCapacity = Math.max(12, Math.ceil(18 + ringIndex * 14));
    const position = index - ringStart;
    const angle = (position / ringCapacity) * Math.PI * 2 - Math.PI / 2 + ringIndex * 0.21;
    const radius = Math.min(286, 82 + ringIndex * 42);
    return {
      host,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      size: nodeSize(host),
    };
  });
}

function hostScore(host: HostObservation) {
  return (host.open_ports.length > 0 ? 100 : 0) + (host.alive ? 20 : 0) + host.open_ports.length;
}

function nodeSize(host: HostObservation) {
  if (host.open_ports.length >= 4) return 34;
  if (host.open_ports.length > 0) return 30;
  if (host.alive) return 24;
  return 18;
}

function nodeClass(host: HostObservation) {
  return categoryFor(host).replaceAll("/", "-").replaceAll(" ", "-");
}

function nodeInitial(host: HostObservation) {
  if (host.open_ports.length === 0 && !host.alive) return "";
  const label = host.hostname || host.vendor || host.device_type || host.ip;
  return label.slice(0, 1).toUpperCase();
}

function formatPorts(ports: PortObservation[]) {
  return ports.map((port) => `${port.port}/${port.service}`).join(", ");
}

function formatTime(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString();
}

function compareIP(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 4; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
