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

type ProbeServiceStatus = {
  probe_path: string;
  install_path: string;
  config_path: string;
  config?: ProbeConfigState;
  found: boolean;
  state: string;
  severity: string;
  summary: string;
  message: string;
  output: string;
};

type ProbeConfigState = {
  cidr: string;
  anchordesk_url: string;
  probe_key: string;
  interval: string;
  config_path: string;
};

type ProbeSetupRequest = {
  cidr: string;
  anchordesk_url: string;
  probe_key: string;
  interval: string;
  probe_path: string;
  install_persistent: boolean;
  start_after_install: boolean;
};

type UpdateInfo = {
  current_version: string;
  latest_version: string;
  available: boolean;
  release_url: string;
  asset_name: string;
  asset_url: string;
  checksum_name: string;
  checksum_url: string;
  download_path: string;
  message: string;
};

type ScanEvent = {
  type: string;
  ip?: string;
  host?: HostObservation;
  checked_hosts?: number;
  total_hosts?: number;
};

type HostHistoryEntry = {
  run_id: string;
  started_at: string;
  ended_at: string;
  host: HostObservation;
};

type Tab = "table" | "graph" | "hierarchy" | "history" | "probe" | "update";
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
          HostHistory(ip: string): Promise<HostHistoryEntry[]>;
          ChooseProbeBinary(): Promise<string>;
          GetProbeStatus(probePath: string): Promise<ProbeServiceStatus>;
          ProvisionProbe(request: ProbeSetupRequest): Promise<ProbeServiceStatus>;
          ProbeServiceAction(action: string, probePath: string): Promise<ProbeServiceStatus>;
          CheckForUpdate(): Promise<UpdateInfo>;
          DownloadLatestUpdate(): Promise<UpdateInfo>;
          OpenUpdateDownload(path: string): Promise<void>;
          ApplyDownloadedUpdate(path: string): Promise<string>;
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
  const [probeURL, setProbeURL] = useState("");
  const [probeKey, setProbeKey] = useState("");
  const [probeInterval, setProbeInterval] = useState("1m");
  const [probePath, setProbePath] = useState("");
  const [installPersistent, setInstallPersistent] = useState(true);
  const [startAfterInstall, setStartAfterInstall] = useState(true);
  const [probeBusy, setProbeBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({
    current_version: "",
    latest_version: "",
    available: false,
    release_url: "",
    asset_name: "",
    asset_url: "",
    checksum_name: "",
    checksum_url: "",
    download_path: "",
    message: "",
  });
  const [probeStatus, setProbeStatus] = useState<ProbeServiceStatus>({
    probe_path: "",
    install_path: "",
    config_path: "",
    found: false,
    state: "unknown",
    severity: "info",
    summary: "",
    message: "",
    output: "",
  });
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
    refreshProbeStatus();
    checkForUpdates(false);
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

  async function refreshProbeStatus(path = probePath) {
    const app = window.go?.main?.App;
    if (!app) return;
    try {
      const status = await app.GetProbeStatus(path);
      setProbeStatus(status);
      if (!probePath && status.probe_path) {
        setProbePath(status.probe_path);
      }
      if (status.config) {
        setCidr(status.config.cidr);
        setProbeURL(status.config.anchordesk_url);
        setProbeKey(status.config.probe_key);
        setProbeInterval(status.config.interval || "1m");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function checkForUpdates(showErrors = true) {
    const app = window.go?.main?.App;
    if (!app) return;
    setUpdateBusy(true);
    if (showErrors) setError("");
    try {
      const info = await app.CheckForUpdate();
      setUpdateInfo(info);
    } catch (err) {
      if (showErrors) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setUpdateBusy(false);
    }
  }

  function applyHostEvent(event: ScanEvent) {
    if (!event.host) return;
    const incoming = normalizeHost(event.host);
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
      nextHosts[host.ip] = normalizeHost(host);
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

  async function chooseProbeBinary() {
    const app = window.go?.main?.App;
    if (!app) return;
    setError("");
    try {
      const chosen = await app.ChooseProbeBinary();
      if (!chosen) return;
      setProbePath(chosen);
      await refreshProbeStatus(chosen);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function provisionProbe() {
    const app = window.go?.main?.App;
    if (!app) return;
    setError("");
    setProbeBusy(true);
    try {
      const status = await app.ProvisionProbe({
        cidr,
        anchordesk_url: probeURL,
        probe_key: probeKey,
        interval: probeInterval,
        probe_path: probePath,
        install_persistent: installPersistent,
        start_after_install: startAfterInstall,
      });
      setProbeStatus(status);
      if (status.probe_path) {
        setProbePath(status.probe_path);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProbeBusy(false);
    }
  }

  async function probeAction(action: string) {
    const app = window.go?.main?.App;
    if (!app) return;
    setError("");
    setProbeBusy(true);
    try {
      const status = await app.ProbeServiceAction(action, probePath);
      setProbeStatus(status);
      if (status.probe_path) {
        setProbePath(status.probe_path);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProbeBusy(false);
    }
  }

  async function downloadUpdate() {
    const app = window.go?.main?.App;
    if (!app) return;
    setError("");
    setUpdateBusy(true);
    try {
      const info = await app.DownloadLatestUpdate();
      setUpdateInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdateBusy(false);
    }
  }

  async function openUpdateDownload() {
    const app = window.go?.main?.App;
    if (!app || !updateInfo.download_path) return;
    setError("");
    try {
      await app.OpenUpdateDownload(updateInfo.download_path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function applyUpdate() {
    const app = window.go?.main?.App;
    if (!app || !updateInfo.download_path) return;
    setError("");
    setUpdateBusy(true);
    try {
      const message = await app.ApplyDownloadedUpdate(updateInfo.download_path);
      setUpdateInfo((info) => ({ ...info, message }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdateBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="toolbar" aria-label="Scan controls">
        <div
          className="fileMenu"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setFileOpen(false);
          }}
        >
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
        <button onClick={toggleMonitor} aria-pressed={monitoring}>
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

      {updateInfo.available && tab !== "update" && (
        <section className="updateBanner" aria-label="Update available">
          <span>{updateInfo.message}</span>
          <button onClick={() => setTab("update")}>Review Update</button>
        </section>
      )}

      <nav className="tabs" aria-label="Views">
        {(["table", "graph", "hierarchy", "history", "probe", "update"] as Tab[]).map((view) => (
          <button
            key={view}
            className={tab === view ? "active" : ""}
            aria-current={tab === view}
            onClick={() => setTab(view)}
          >
            {view[0].toUpperCase() + view.slice(1)}
          </button>
        ))}
      </nav>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button className="errorDismiss" onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      {tab === "table" && <TableView rows={visibleRows} states={deviceStates} hiddenCount={hiddenCheckedOnly} />}
      {tab === "graph" && <GraphView hosts={visibleRows} states={deviceStates} />}
      {tab === "hierarchy" && <HierarchyView hosts={visibleRows} states={deviceStates} />}
      {tab === "history" && <HistoryView history={history} diff={diff} onRefresh={refreshHistory} />}
      {tab === "probe" && (
        <ProbeView
          cidr={cidr}
          url={probeURL}
          setURL={setProbeURL}
          keyValue={probeKey}
          setKey={setProbeKey}
          interval={probeInterval}
          setInterval={setProbeInterval}
          probePath={probePath}
          installPersistent={installPersistent}
          setInstallPersistent={setInstallPersistent}
          startAfterInstall={startAfterInstall}
          setStartAfterInstall={setStartAfterInstall}
          status={probeStatus}
          busy={probeBusy}
          onChooseBinary={chooseProbeBinary}
          onProvision={provisionProbe}
          onRefresh={() => refreshProbeStatus()}
          onAction={probeAction}
        />
      )}
      {tab === "update" && (
        <UpdateView
          info={updateInfo}
          busy={updateBusy}
          onCheck={() => checkForUpdates(true)}
          onDownload={downloadUpdate}
          onOpenDownload={openUpdateDownload}
          onApply={applyUpdate}
        />
      )}
    </main>
  );
}

function UpdateView({
  info,
  busy,
  onCheck,
  onDownload,
  onOpenDownload,
  onApply,
}: {
  info: UpdateInfo;
  busy: boolean;
  onCheck: () => void;
  onDownload: () => void;
  onOpenDownload: () => void;
  onApply: () => void;
}) {
  return (
    <section className="updateWrap" aria-label="Application update">
      <div className="updateHeader">
        <div>
          <h2>Update</h2>
          <p className="quiet">{info.message || "Check GitHub Releases for a newer NetViz build."}</p>
        </div>
        <button onClick={onCheck} disabled={busy}>Check</button>
      </div>

      <div className="updateGrid">
        <section className="updatePanel">
          <h3>Version</h3>
          <dl className="updateDetails">
            <div>
              <dt>Installed</dt>
              <dd>{info.current_version || "unknown"}</dd>
            </div>
            <div>
              <dt>Latest</dt>
              <dd>{info.latest_version || "unknown"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{info.available ? "update available" : info.message || "not checked"}</dd>
            </div>
          </dl>
        </section>

        <section className="updatePanel">
          <h3>Release Asset</h3>
          <dl className="updateDetails">
            <div>
              <dt>Asset</dt>
              <dd>{info.asset_name || "none selected"}</dd>
            </div>
            <div>
              <dt>Checksum</dt>
              <dd>{info.checksum_name || "not available"}</dd>
            </div>
            <div>
              <dt>Downloaded</dt>
              <dd>{info.download_path || "not downloaded"}</dd>
            </div>
          </dl>
          <div className="buttonRow">
            <button className="primary" onClick={onDownload} disabled={busy || !info.available}>
              Download Update
            </button>
            <button className="primary" onClick={onApply} disabled={busy || !info.download_path}>
              Install and Restart
            </button>
            <button onClick={onOpenDownload} disabled={busy || !info.download_path}>
              Open Download
            </button>
          </div>
          <p className="quiet">
            Updates are downloaded only after confirmation and verified with the release checksum when
            GitHub provides one. Install and Restart swaps the desktop binary and keeps the previous
            version next to it as a .old backup.
          </p>
        </section>
      </div>
    </section>
  );
}

function ProbeView({
  cidr,
  url,
  setURL,
  keyValue,
  setKey,
  interval,
  setInterval,
  probePath,
  installPersistent,
  setInstallPersistent,
  startAfterInstall,
  setStartAfterInstall,
  status,
  busy,
  onChooseBinary,
  onProvision,
  onRefresh,
  onAction,
}: {
  cidr: string;
  url: string;
  setURL: (value: string) => void;
  keyValue: string;
  setKey: (value: string) => void;
  interval: string;
  setInterval: (value: string) => void;
  probePath: string;
  installPersistent: boolean;
  setInstallPersistent: (value: boolean) => void;
  startAfterInstall: boolean;
  setStartAfterInstall: (value: boolean) => void;
  status: ProbeServiceStatus;
  busy: boolean;
  onChooseBinary: () => void;
  onProvision: () => void;
  onRefresh: () => void;
  onAction: (action: string) => void;
}) {
  return (
    <section className="probeWrap" aria-label="Probe setup">
      <div className="probeHeader">
        <div>
          <h2>Probe setup</h2>
          <p className="quiet">Provision the headless service from this desktop configuration.</p>
        </div>
        <div className={`probeState ${stateClassName(status.state)}`}>
          <span>{status.found ? status.state : "probe missing"}</span>
          <button onClick={onRefresh} disabled={busy}>Refresh</button>
        </div>
      </div>

      <div className="probeGrid">
        <section className="probePanel">
          <h3>Configuration</h3>
          <label className="field wide">
            <span>Current CIDR</span>
            <input value={cidr} readOnly />
          </label>
          <label className="field wide">
            <span>AnchorDesk URL</span>
            <input value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://rmm.example.com" />
          </label>
          <label className="field wide">
            <span>Probe API key</span>
            <input value={keyValue} onChange={(event) => setKey(event.target.value)} type="password" />
          </label>
          <label className="field">
            <span>Interval</span>
            <input value={interval} onChange={(event) => setInterval(event.target.value)} placeholder="1m" />
          </label>
          <label className="toggle">
            <input type="checkbox" checked={installPersistent} onChange={(event) => setInstallPersistent(event.target.checked)} />
            <span>Install persistent probe service</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={startAfterInstall}
              onChange={(event) => setStartAfterInstall(event.target.checked)}
              disabled={!installPersistent}
            />
            <span>Start service after install</span>
          </label>
          <button className="primary" onClick={onProvision} disabled={busy}>
            {busy ? "Working…" : installPersistent ? "Provision Probe" : "Send Once"}
          </button>
        </section>

        <section className="probePanel">
          <h3>Service</h3>
          <label className="field wide">
            <span>Install location</span>
            <input value={status.install_path} readOnly />
          </label>
          <label className="field wide">
            <span>Config file</span>
            <input value={status.config_path || status.config?.config_path || ""} readOnly />
          </label>
          <div className="buttonRow">
            <button onClick={() => onAction("start")} disabled={busy || !status.found}>Start</button>
            <button onClick={() => onAction("stop")} disabled={busy || !status.found}>Stop</button>
            <button onClick={() => onAction("restart")} disabled={busy || !status.found}>Restart</button>
            <button onClick={() => onAction("uninstall")} disabled={busy || !status.found}>Uninstall</button>
            {!status.found && (
              <button onClick={onChooseBinary} disabled={busy}>Locate netviz-probe…</button>
            )}
          </div>
          {probePath && status.install_path && probePath !== status.install_path && (
            <p className="quiet">Next provision deploys {probePath} to the install location.</p>
          )}
          <ProbeOutcome status={status} />
          <p className="quiet">
            Provisioning installs netviz-probe to the location above and runs the service from
            there. Install, start, stop, and uninstall may require administrator or root elevation.
          </p>
        </section>
      </div>
    </section>
  );
}

function ProbeOutcome({ status }: { status: ProbeServiceStatus }) {
  const detail = status.output || status.message;
  return (
    <section className={`probeOutcome ${status.severity || "info"}`}>
      <div>
        <strong>{status.summary || "Probe status"}</strong>
        <span>{probeOutcomeDetail(status)}</span>
      </div>
      {detail && (
        <details>
          <summary>Command details</summary>
          <pre>{detail}</pre>
        </details>
      )}
    </section>
  );
}

function probeOutcomeDetail(status: ProbeServiceStatus) {
  if (!status.found) return "netviz-probe was not found. It ships in the bin folder of the NetViz download — locate it to continue.";
  if (status.state === "running") return "The persistent probe service is active.";
  if (status.state === "stopped") return "The service is installed and ready to start.";
  if (status.state === "not installed") return "Provision the probe to install the persistent service.";
  return status.message || "Refresh to read the latest service status.";
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
                <span className="legendItem">
                  <i className={`legendSwatch ${categoryClass(group.name)}`} aria-hidden="true" />
                  {CATEGORY_EMOJI[group.name] ? `${CATEGORY_EMOJI[group.name]} ${group.name}` : group.name}
                </span>
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
          <div className="legend" aria-label="Device type colors">
            {CATEGORY_NAMES.map((name) => (
              <span className="legendItem" key={name}>
                <i className={`legendSwatch ${categoryClass(name)}`} aria-hidden="true" />
                {CATEGORY_EMOJI[name] ? `${CATEGORY_EMOJI[name]} ${name}` : name}
              </span>
            ))}
          </div>
        </div>

        <div className="radialMap">
          <svg className="edges" viewBox="0 0 1000 620" preserveAspectRatio="none" role="presentation" aria-hidden="true">
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
              <span style={CATEGORY_EMOJI[categoryFor(item.host)] ? { fontSize: Math.max(10, item.size * 0.52) } : undefined}>
                {CATEGORY_EMOJI[categoryFor(item.host)] || nodeInitial(item.host)}
              </span>
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
  const [history, setHistory] = useState<HostHistoryEntry[]>([]);
  const ip = host?.ip || "";

  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    if (!ip) return;
    window.go?.main?.App?.HostHistory(ip)
      .then((entries) => {
        if (!cancelled) {
          setHistory((entries || []).map((entry) => ({ ...entry, host: normalizeHost(entry.host) })));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ip]);

  return (
    <aside className="detailPanel" aria-label="Selected device details">
      {host ? (
        <>
          <div className="detailHeader">
            <h2>{host.hostname || host.ip}</h2>
            <div className="detailBadges">
              <span>
                {CATEGORY_EMOJI[categoryFor(host)] ? `${CATEGORY_EMOJI[categoryFor(host)]} ` : ""}
                {host.device_type}
              </span>
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
          <section className="miniHistory">
            <h3>History</h3>
            {history.length > 0 ? (
              <div className="miniHistoryList">
                {history.map((entry) => (
                  <div className="miniHistoryRow" key={entry.run_id}>
                    <span className="miniHistoryTime">{formatHistoryRange(entry)}</span>
                    <span>{summarizeObservation(entry.host)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="quiet">No stored history for this device yet.</p>
            )}
            {history.length > 0 && (
              <p className="quiet">Idle monitor cycles are merged; each row is an observed state.</p>
            )}
          </section>
        </>
      ) : (
        <p className="quiet">Run a scan to select a device.</p>
      )}
    </aside>
  );
}

function formatHistoryRange(entry: HostHistoryEntry) {
  const start = new Date(entry.started_at);
  const end = entry.ended_at ? new Date(entry.ended_at) : null;
  const day = start.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  const startTime = start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (!end || end.getTime() - start.getTime() < 90_000) {
    return `${day} ${startTime}`;
  }
  const endTime = end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} ${startTime}–${endTime}`;
}

function summarizeObservation(host: HostObservation) {
  if (!host.alive && host.open_ports.length === 0) return "down";
  const ports = host.open_ports.map((port) => port.port).join(", ");
  return ports ? `up · ${ports}` : "up";
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

const CATEGORY_NAMES = ["firewall/network", "windows/smb", "linux/iot", "apple", "printer", "camera/media", "web appliance", "unknown"];

const CATEGORY_EMOJI: Record<string, string> = {
  "firewall/network": "🌐",
  "windows/smb": "💻",
  "linux/iot": "🐧",
  apple: "🍎",
  printer: "🖨️",
  "camera/media": "🎥",
  "web appliance": "🖥️",
  unknown: "",
};

function categoryClass(name: string) {
  return name.replaceAll("/", "-").replaceAll(" ", "-");
}

function groupHosts(hosts: HostObservation[]) {
  const groups = CATEGORY_NAMES.map((name) => ({ name, hosts: [] as HostObservation[] }));
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

function stateClassName(state: string) {
  return `state-${state.toLowerCase().replaceAll(" ", "-")}`;
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
  const innerRadius = 132;
  const ringGap = 80;
  const maxRadius = 276;

  // Fill rings inside-out with capacity proportional to circumference, then
  // spread each ring's actual occupants around the full circle — a partial
  // ring must never bunch into an arc.
  const spacing = sorted.length > 90 ? 36 : sorted.length > 40 ? 46 : 58;
  const sizeScale = sorted.length > 90 ? 0.7 : 1;
  const rings: HostObservation[][] = [];
  for (let taken = 0, ring = 0; taken < sorted.length; ring += 1) {
    const capacity = Math.max(8, Math.floor((2 * Math.PI * (innerRadius + ring * ringGap)) / spacing));
    rings.push(sorted.slice(taken, taken + capacity));
    taken += capacity;
  }
  // Compress ring spacing when there are more rings than the canvas can hold.
  const spread = rings.length > 1 ? Math.min(ringGap, (maxRadius - innerRadius) / (rings.length - 1)) : 0;

  return rings.flatMap((ringHosts, ring) => {
    const radius = innerRadius + ring * spread;
    return ringHosts.map((host, position) => {
      const angle = (position / ringHosts.length) * Math.PI * 2 - Math.PI / 2 + ring * 0.4;
      return {
        host,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        size: Math.max(12, Math.round(nodeSize(host) * sizeScale)),
      };
    });
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
  return categoryClass(categoryFor(host));
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

// normalizeHost guards against hosts arriving over the wire with null or
// missing fields (JSON null for an empty Go slice, older saved scan files);
// every view indexes open_ports directly.
function normalizeHost(host: HostObservation): HostObservation {
  return {
    ...host,
    open_ports: Array.isArray(host.open_ports) ? host.open_ports : [],
    device_type: host.device_type || "unknown",
  };
}

type ErrorBoundaryState = { error?: Error };

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="shell crashShell">
          <section className="error" role="alert">
            <strong>NetViz hit an unexpected error and stopped rendering.</strong>
            <pre className="crashDetail">{this.state.error.message}</pre>
            <button onClick={() => this.setState({ error: undefined })}>Try to continue</button>
            <button onClick={() => window.location.reload()}>Reload app</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
