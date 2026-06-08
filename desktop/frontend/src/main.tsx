import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type PortObservation = {
  port: number;
  service: string;
};

type HostObservation = {
  ip: string;
  hostname?: string;
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

type Tab = "table" | "graph" | "history";

declare global {
  interface Window {
    go?: {
      main?: {
        App?: {
          StartScan(cidr: string): Promise<void>;
          CancelScan(): Promise<void>;
          ExportJSON(): Promise<string>;
          ExportCSV(): Promise<string>;
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
  const [history, setHistory] = useState<ScanRun[]>([]);
  const [diff, setDiff] = useState<ScanDiff>({ base_run_id: "", compare_run_id: "" });
  const [tab, setTab] = useState<Tab>("table");
  const [scanning, setScanning] = useState(false);
  const [checkedHosts, setCheckedHosts] = useState(0);
  const [totalHosts, setTotalHosts] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    refreshHistory();
    const offEvent = window.runtime?.EventsOn("scan:event", (payload) => {
      const event = payload as ScanEvent;
      if (event.host) {
        setHosts((current) => ({ ...current, [event.host!.ip]: event.host! }));
      }
      if (event.checked_hosts !== undefined) {
        setCheckedHosts(event.checked_hosts);
      }
      if (event.total_hosts !== undefined) {
        setTotalHosts(event.total_hosts);
      }
      if (event.type === "scan_finished") {
        setScanning(false);
      }
    });
    const offState = window.runtime?.EventsOn("scan:state", (payload) => {
      const state = payload as { scanning?: boolean };
      if (typeof state.scanning === "boolean") {
        setScanning(state.scanning);
      }
    });
    const offHistory = window.runtime?.EventsOn("history:updated", () => {
      refreshHistory();
    });
    const offHistoryError = window.runtime?.EventsOn("history:error", (payload) => {
      setError(String(payload));
    });
    return () => {
      if (typeof offEvent === "function") offEvent();
      if (typeof offState === "function") offState();
      if (typeof offHistory === "function") offHistory();
      if (typeof offHistoryError === "function") offHistoryError();
    };
  }, []);

  const rows = useMemo(() => {
    return Object.values(hosts).sort((a, b) => compareIP(a.ip, b.ip));
  }, [hosts]);

  const aliveRows = rows.filter((host) => host.alive);
  const openPortsFound = rows.reduce((sum, host) => sum + host.open_ports.length, 0);

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

  async function startScan() {
    setError("");
    setHosts({});
    setCheckedHosts(0);
    setTotalHosts(0);
    try {
      await window.go?.main?.App?.StartScan(cidr);
      setScanning(true);
    } catch (err) {
      setScanning(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelScan() {
    await window.go?.main?.App?.CancelScan();
  }

  async function exportData(kind: "json" | "csv") {
    const app = window.go?.main?.App;
    if (!app) return;
    const content = kind === "json" ? await app.ExportJSON() : await app.ExportCSV();
    const type = kind === "json" ? "application/json" : "text/csv";
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `netviz-scan.${kind}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="shell">
      <section className="toolbar" aria-label="Scan controls">
        <label className="field">
          <span>CIDR</span>
          <input value={cidr} onChange={(event) => setCidr(event.target.value)} disabled={scanning} />
        </label>
        <button className="primary" onClick={startScan} disabled={scanning}>
          Start Scan
        </button>
        <button onClick={cancelScan} disabled={!scanning}>
          Cancel
        </button>
        <button onClick={() => exportData("json")} disabled={rows.length === 0}>
          Export JSON
        </button>
        <button onClick={() => exportData("csv")} disabled={rows.length === 0}>
          Export CSV
        </button>
      </section>

      <section className="status" aria-label="Scan status">
        <span>{scanning ? "scanning" : "not scanning"}</span>
        <span>{checkedHosts}/{totalHosts || 0} hosts checked</span>
        <span>{aliveRows.length} alive</span>
        <span>{openPortsFound} open ports</span>
      </section>

      <nav className="tabs" aria-label="Views">
        <button className={tab === "table" ? "active" : ""} onClick={() => setTab("table")}>
          Table
        </button>
        <button className={tab === "graph" ? "active" : ""} onClick={() => setTab("graph")}>
          Graph
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          History
        </button>
      </nav>

      {error && <div className="error">{error}</div>}

      {tab === "table" && <TableView rows={rows} />}
      {tab === "graph" && <GraphView hosts={aliveRows} />}
      {tab === "history" && <HistoryView history={history} diff={diff} onRefresh={refreshHistory} />}
    </main>
  );
}

function TableView({ rows }: { rows: HostObservation[] }) {
  return (
    <section className="tableWrap" aria-label="Scan results">
      <table>
        <thead>
          <tr>
            <th>IP</th>
            <th>Hostname</th>
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
              <td>{host.alive ? "yes" : "no"}</td>
              <td>{formatPorts(host.open_ports)}</td>
              <td>{host.device_type}</td>
              <td>{formatTime(host.first_seen)}</td>
              <td>{formatTime(host.last_updated)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty" colSpan={7}>
                No scan results yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function GraphView({ hosts }: { hosts: HostObservation[] }) {
  const groups = groupHosts(hosts);
  return (
    <section className="graphWrap" aria-label="Network graph">
      <div className="graphRoot">
        <div className="rootNode">LAN</div>
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
                <article className="deviceNode" key={host.ip}>
                  <div className="deviceTitle">{host.hostname || host.ip}</div>
                  <div className="deviceIP">{host.ip}</div>
                  <div className="badges">
                    {host.open_ports.map((port) => (
                      <span key={`${host.ip}-${port.port}`}>{port.port}</span>
                    ))}
                  </div>
                </article>
              ))}
              {group.hosts.length === 0 && <div className="emptyGroup">No devices</div>}
            </div>
          </section>
        ))}
      </div>
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
                    <span>{change.hostname_changed ? "hostname " : ""}{change.ports_changed ? "ports " : ""}{change.device_type_changed ? "type" : ""}</span>
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

function groupHosts(hosts: HostObservation[]) {
  const names = ["router/network", "windows/smb", "linux/ssh", "printer", "web appliance", "unknown"];
  const groups = names.map((name) => ({ name, hosts: [] as HostObservation[] }));
  for (const host of hosts) {
    groups.find((group) => group.name === categoryFor(host))!.hosts.push(host);
  }
  return groups;
}

function categoryFor(host: HostObservation) {
  if (host.open_ports.some((port) => port.port === 53)) return "router/network";
  if (host.device_type === "windows_or_smb" || host.device_type === "windows_rdp") return "windows/smb";
  if (host.device_type === "ssh_device") return "linux/ssh";
  if (host.device_type === "printer") return "printer";
  if (host.device_type === "web_device" || host.device_type === "plex") return "web appliance";
  return "unknown";
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

