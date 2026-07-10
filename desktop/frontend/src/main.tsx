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
          StartScan(cidr: string, ports: number[]): Promise<void>;
          StartMonitorScan(cidr: string, ports: number[]): Promise<void>;
          CancelScan(): Promise<void>;
          DefaultPorts(): Promise<PortObservation[]>;
          SaveScanFile(): Promise<void>;
          OpenScanFile(): Promise<HostObservation[] | null>;
          SaveCSVFile(): Promise<void>;
          ListHistory(): Promise<ScanRun[]>;
          LatestDiff(): Promise<ScanDiff>;
          DiffRuns(baseRunID: string, compareRunID: string): Promise<ScanDiff>;
          DeleteRun(runID: string): Promise<void>;
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

type AppError = { id: number; text: string };

const MONITOR_INTERVALS = [
  { label: "15s", ms: 15_000 },
  { label: "30s", ms: 30_000 },
  { label: "1m", ms: 60_000 },
  { label: "5m", ms: 300_000 },
];

function readSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Settings persistence is best-effort; never let it break the app.
  }
}

// parseExtraPorts accepts "8006, 9443 10000" and keeps only valid, unique
// TCP ports; everything else is silently dropped so typing never errors.
function parseExtraPorts(text: string): number[] {
  const ports = new Set<number>();
  for (const token of text.split(/[\s,;]+/)) {
    if (!/^\d{1,5}$/.test(token)) continue;
    const port = Number(token);
    if (port >= 1 && port <= 65535) ports.add(port);
  }
  return [...ports];
}

function App() {
  const [cidr, setCidr] = useState(() => readSetting("netviz.cidr") || "192.168.1.0/24");
  const [hosts, setHosts] = useState<Record<string, HostObservation>>({});
  const [deviceStates, setDeviceStates] = useState<Record<string, DeviceState>>({});
  const [history, setHistory] = useState<ScanRun[]>([]);
  const [diff, setDiff] = useState<ScanDiff>({ base_run_id: "", compare_run_id: "" });
  const [tab, setTab] = useState<Tab>("table");
  const [scanning, setScanning] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [showCheckedOnly, setShowCheckedOnly] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [portsOpen, setPortsOpen] = useState(false);
  const [portDefs, setPortDefs] = useState<PortObservation[]>([]);
  const [disabledPorts, setDisabledPorts] = useState<number[]>(() => {
    try {
      const saved = JSON.parse(readSetting("netviz.disabledPorts") || "[]");
      return Array.isArray(saved) ? saved.filter((p) => Number.isInteger(p)) : [];
    } catch {
      return [];
    }
  });
  const [extraPorts, setExtraPorts] = useState(() => readSetting("netviz.extraPorts") || "");
  const [checkedHosts, setCheckedHosts] = useState(0);
  const [totalHosts, setTotalHosts] = useState(0);
  const [errors, setErrors] = useState<AppError[]>([]);
  const [monitorMs, setMonitorMs] = useState(() => {
    const saved = Number(readSetting("netviz.monitorMs"));
    return MONITOR_INTERVALS.some((interval) => interval.ms === saved) ? saved : 15_000;
  });
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
  const scanPortsRef = useRef<number[]>([]);
  // Mirror of the hosts state, so event handlers can read the previous
  // observation without doing work inside a React state updater.
  const hostsRef = useRef<Record<string, HostObservation>>({});
  const errorSeq = useRef(0);

  function pushError(err: unknown) {
    const text = err instanceof Error ? err.message : String(err);
    if (!text) return;
    setErrors((current) => {
      if (current.some((item) => item.text === text)) return current;
      errorSeq.current += 1;
      return [...current.slice(-3), { id: errorSeq.current, text }];
    });
  }

  function dismissError(id: number) {
    setErrors((current) => current.filter((item) => item.id !== id));
  }

  useEffect(() => {
    monitoringRef.current = monitoring;
  }, [monitoring]);

  useEffect(() => {
    writeSetting("netviz.cidr", cidr);
  }, [cidr]);

  useEffect(() => {
    writeSetting("netviz.monitorMs", String(monitorMs));
  }, [monitorMs]);

  useEffect(() => {
    writeSetting("netviz.disabledPorts", JSON.stringify(disabledPorts));
  }, [disabledPorts]);

  useEffect(() => {
    writeSetting("netviz.extraPorts", extraPorts);
  }, [extraPorts]);

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
    window.go?.main?.App?.DefaultPorts?.()
      .then((defs) => setPortDefs(defs || []))
      .catch(() => {});
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
      pushError(payload);
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

  const cidrValid = isValidCIDR(cidr);
  // With nothing customized an empty list is sent and the scanner uses its
  // defaults; a customized selection is sent explicitly.
  const extraPortList = useMemo(() => parseExtraPorts(extraPorts), [extraPorts]);
  const portsCustomized = disabledPorts.length > 0 || extraPortList.length > 0;
  const scanPorts = useMemo(() => {
    if (!portsCustomized) return [];
    const enabled = portDefs.map((def) => def.port).filter((port) => !disabledPorts.includes(port));
    return [...new Set([...enabled, ...extraPortList])].sort((a, b) => a - b);
  }, [portsCustomized, portDefs, disabledPorts, extraPortList]);
  const portsValid = !portsCustomized || (scanPorts.length > 0 && scanPorts.length <= 64);

  useEffect(() => {
    scanPortsRef.current = scanPorts;
  }, [scanPorts]);

  const aliveRows = rows.filter((host) => host.alive);
  const openPortsFound = rows.reduce((sum, host) => sum + host.open_ports.length, 0);
  const offlineCount = Object.values(deviceStates).filter((state) => state === "offline").length;
  const hiddenCheckedOnly = rows.length - visibleRows.length;

  useEffect(() => {
    if (!monitoring || scanning) return;
    const timer = window.setTimeout(() => {
      void startScan(true, true);
    }, rows.length === 0 ? 100 : monitorMs);
    return () => window.clearTimeout(timer);
  }, [monitoring, scanning, rows.length, monitorMs]);

  async function refreshHistory() {
    const app = window.go?.main?.App;
    if (!app) return;
    try {
      const [runs, latestDiff] = await Promise.all([app.ListHistory(), app.LatestDiff()]);
      setHistory(runs || []);
      setDiff(latestDiff || { base_run_id: "", compare_run_id: "" });
    } catch (err) {
      pushError(err);
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
      pushError(err);
    }
  }

  async function checkForUpdates(showErrors = true) {
    const app = window.go?.main?.App;
    if (!app) return;
    setUpdateBusy(true);
    if (showErrors) setErrors([]);
    try {
      const info = await app.CheckForUpdate();
      setUpdateInfo(info);
    } catch (err) {
      if (showErrors) {
        pushError(err);
      }
    } finally {
      setUpdateBusy(false);
    }
  }

  function applyHostEvent(event: ScanEvent) {
    if (!event.host) return;
    const incoming = normalizeHost(event.host);
    const previous = hostsRef.current[incoming.ip];
    if (monitoringRef.current && event.type === "host_seen" && previous) {
      return;
    }
    hostsRef.current = { ...hostsRef.current, [incoming.ip]: incoming };
    setHosts(hostsRef.current);
    if (event.type === "host_done" || event.type === "host_enriched" || event.type === "port_open" || event.type === "device_classified") {
      const state = classifyTransition(previous, incoming);
      setDeviceStates((states) => ({ ...states, [incoming.ip]: state }));
    }
  }

  function loadHosts(opened: HostObservation[]) {
    const nextHosts: Record<string, HostObservation> = {};
    for (const host of opened) {
      nextHosts[host.ip] = normalizeHost(host);
    }
    hostsRef.current = nextHosts;
    setHosts(nextHosts);
    setDeviceStates({});
    setCheckedHosts(0);
    setTotalHosts(opened.length);
  }

  async function startScan(preserve = false, fromMonitor = false) {
    setErrors([]);
    if (!preserve) {
      hostsRef.current = {};
      setHosts({});
      setDeviceStates({});
    }
    setCheckedHosts(0);
    setTotalHosts(0);
    try {
      if (preserve) {
        await window.go?.main?.App?.StartMonitorScan(cidrRef.current, scanPortsRef.current);
      } else {
        await window.go?.main?.App?.StartScan(cidrRef.current, scanPortsRef.current);
      }
      setScanning(true);
      scanningRef.current = true;
    } catch (err) {
      setScanning(false);
      scanningRef.current = false;
      if (fromMonitor && !monitoringRef.current) return;
      pushError(err);
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
    setErrors([]);
    setFileOpen(false);
    try {
      await app.SaveScanFile();
    } catch (err) {
      pushError(err);
    }
  }

  async function openScan() {
    const app = window.go?.main?.App;
    if (!app) return;
    setErrors([]);
    setFileOpen(false);
    try {
      const opened = await app.OpenScanFile();
      if (!opened) return;
      loadHosts(opened);
    } catch (err) {
      pushError(err);
    }
  }

  async function saveCSV() {
    const app = window.go?.main?.App;
    if (!app) return;
    setErrors([]);
    setFileOpen(false);
    try {
      await app.SaveCSVFile();
    } catch (err) {
      pushError(err);
    }
  }

  async function chooseProbeBinary() {
    const app = window.go?.main?.App;
    if (!app) return;
    setErrors([]);
    try {
      const chosen = await app.ChooseProbeBinary();
      if (!chosen) return;
      setProbePath(chosen);
      await refreshProbeStatus(chosen);
    } catch (err) {
      pushError(err);
    }
  }

  async function provisionProbe() {
    const app = window.go?.main?.App;
    if (!app) return;
    setErrors([]);
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
      pushError(err);
    } finally {
      setProbeBusy(false);
    }
  }

  async function probeAction(action: string) {
    const app = window.go?.main?.App;
    if (!app) return;
    setErrors([]);
    setProbeBusy(true);
    try {
      const status = await app.ProbeServiceAction(action, probePath);
      setProbeStatus(status);
      if (status.probe_path) {
        setProbePath(status.probe_path);
      }
    } catch (err) {
      pushError(err);
    } finally {
      setProbeBusy(false);
    }
  }

  async function downloadUpdate() {
    const app = window.go?.main?.App;
    if (!app) return;
    setErrors([]);
    setUpdateBusy(true);
    try {
      const info = await app.DownloadLatestUpdate();
      setUpdateInfo(info);
    } catch (err) {
      pushError(err);
    } finally {
      setUpdateBusy(false);
    }
  }

  async function openUpdateDownload() {
    const app = window.go?.main?.App;
    if (!app || !updateInfo.download_path) return;
    setErrors([]);
    try {
      await app.OpenUpdateDownload(updateInfo.download_path);
    } catch (err) {
      pushError(err);
    }
  }

  async function applyUpdate() {
    const app = window.go?.main?.App;
    if (!app || !updateInfo.download_path) return;
    setErrors([]);
    setUpdateBusy(true);
    try {
      const message = await app.ApplyDownloadedUpdate(updateInfo.download_path);
      setUpdateInfo((info) => ({ ...info, message }));
    } catch (err) {
      pushError(err);
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
          <input
            value={cidr}
            onChange={(event) => setCidr(event.target.value)}
            disabled={scanning}
            className={cidrValid ? "" : "invalid"}
            aria-invalid={!cidrValid}
            title={cidrValid ? undefined : "Enter an IPv4 CIDR such as 192.168.1.0/24"}
          />
        </label>
        <button
          className="primary"
          onClick={() => startScan(false)}
          disabled={scanning || !cidrValid || !portsValid}
          title={
            !cidrValid
              ? "Enter a valid IPv4 CIDR to scan"
              : !portsValid
                ? "Select at least one port (max 64) in the Ports menu"
                : undefined
          }
        >
          Start Scan
        </button>
        <button onClick={toggleMonitor} aria-pressed={monitoring} disabled={!monitoring && (!cidrValid || !portsValid)}>
          {monitoring ? "Stop Monitor" : "Monitor"}
        </button>
        <label className="field">
          <span>Every</span>
          <select
            value={monitorMs}
            onChange={(event) => setMonitorMs(Number(event.target.value))}
            aria-label="Monitor interval"
          >
            {MONITOR_INTERVALS.map((interval) => (
              <option key={interval.ms} value={interval.ms}>
                {interval.label}
              </option>
            ))}
          </select>
        </label>
        <button onClick={cancelScan} disabled={!scanning}>
          Cancel
        </button>
        <div
          className="portsMenu"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setPortsOpen(false);
          }}
        >
          <button
            onClick={() => setPortsOpen((open) => !open)}
            aria-expanded={portsOpen}
            className={portsValid ? "" : "attention"}
            title="Choose which TCP ports scans probe"
          >
            Ports{portsCustomized ? ` (${scanPorts.length})` : ""}
          </button>
          {portsOpen && (
            <div className="portsPanel">
              <div className="portsPanelHeader">
                <strong>Scan ports</strong>
                <button
                  className="linklike"
                  onClick={() => {
                    setDisabledPorts([]);
                    setExtraPorts("");
                  }}
                  disabled={!portsCustomized}
                >
                  Reset to defaults
                </button>
              </div>
              <div className="portsGrid">
                {portDefs.map((def) => (
                  <label className="toggle compact" key={def.port}>
                    <input
                      type="checkbox"
                      checked={!disabledPorts.includes(def.port)}
                      onChange={(event) =>
                        setDisabledPorts((current) =>
                          event.target.checked ? current.filter((p) => p !== def.port) : [...current, def.port]
                        )
                      }
                    />
                    <span>
                      {def.port} <em>{def.service}</em>
                    </span>
                  </label>
                ))}
              </div>
              <label className="field wide">
                <span>Extra ports (comma-separated)</span>
                <input
                  value={extraPorts}
                  onChange={(event) => setExtraPorts(event.target.value)}
                  placeholder="e.g. 8006, 9443"
                />
              </label>
              <p className="quiet portsSummary">
                {portsValid
                  ? portsCustomized
                    ? `${scanPorts.length} ports will be scanned.`
                    : `Scanning the ${portDefs.length || "default"} default LAN ports.`
                  : scanPorts.length === 0
                    ? "Select at least one port."
                    : `Too many ports selected (${scanPorts.length}); the limit is 64.`}
              </p>
            </div>
          )}
        </div>
        <label className="toggle compact" title="Include addresses that were checked but gave no response">
          <input type="checkbox" checked={showCheckedOnly} onChange={(event) => setShowCheckedOnly(event.target.checked)} />
          <span>Show unresponsive</span>
        </label>
      </section>

      <section className="status" aria-label="Scan status">
        <span>{scanning ? "scanning" : "idle"}</span>
        <span>{checkedHosts}/{totalHosts || 0} hosts checked</span>
        <span>{aliveRows.length} alive</span>
        <span>{openPortsFound} open ports</span>
        <span>{offlineCount} offline</span>
        <span>{visibleRows.length} shown</span>
        {hiddenCheckedOnly > 0 && <span>{hiddenCheckedOnly} unresponsive hidden</span>}
        {monitoring && <span>monitoring every {MONITOR_INTERVALS.find((interval) => interval.ms === monitorMs)?.label}</span>}
        {scanning && totalHosts > 0 && (
          <div
            className="progressTrack"
            role="progressbar"
            aria-label="Scan progress"
            aria-valuemin={0}
            aria-valuemax={totalHosts}
            aria-valuenow={Math.min(checkedHosts, totalHosts)}
          >
            <div className="progressFill" style={{ width: `${Math.min(100, (checkedHosts / totalHosts) * 100)}%` }} />
          </div>
        )}
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

      {errors.map((item) => (
        <div className="error" role="alert" key={item.id}>
          <span>{item.text}</span>
          <button className="errorDismiss" onClick={() => dismissError(item.id)} aria-label="Dismiss error">
            ×
          </button>
        </div>
      ))}

      {tab === "table" && <TableView rows={visibleRows} states={deviceStates} hiddenCount={hiddenCheckedOnly} />}
      {tab === "graph" && <GraphView hosts={visibleRows} states={deviceStates} />}
      {tab === "hierarchy" && <HierarchyView hosts={visibleRows} states={deviceStates} />}
      {tab === "history" && <HistoryView history={history} diff={diff} onRefresh={refreshHistory} onError={pushError} />}
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

type SortKey =
  | "ip"
  | "hostname"
  | "mac"
  | "vendor"
  | "state"
  | "alive"
  | "ports"
  | "type"
  | "first_seen"
  | "last_updated";

const TABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "ip", label: "IP" },
  { key: "hostname", label: "Hostname" },
  { key: "mac", label: "MAC" },
  { key: "vendor", label: "Vendor" },
  { key: "state", label: "State" },
  { key: "alive", label: "Alive" },
  { key: "ports", label: "Open ports" },
  { key: "type", label: "Guessed device type" },
  { key: "first_seen", label: "First seen" },
  { key: "last_updated", label: "Last updated" },
];

// textCompare sorts case-insensitively with blanks last, so sorting by
// hostname doesn't pin every no-hostname address to the top.
function textCompare(a: string, b: string) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function compareHosts(a: HostObservation, b: HostObservation, key: SortKey, states: Record<string, DeviceState>) {
  switch (key) {
    case "hostname":
      return textCompare(a.hostname || "", b.hostname || "");
    case "mac":
      return textCompare(a.mac_address || "", b.mac_address || "");
    case "vendor":
      return textCompare(a.vendor || "", b.vendor || "");
    case "state":
      return textCompare(states[a.ip] || "stable", states[b.ip] || "stable");
    case "alive":
      return (b.alive ? 1 : 0) - (a.alive ? 1 : 0);
    case "ports":
      return b.open_ports.length - a.open_ports.length || textCompare(formatPorts(a.open_ports), formatPorts(b.open_ports));
    case "type":
      return textCompare(a.device_type, b.device_type);
    case "first_seen":
      return Date.parse(a.first_seen || "") - Date.parse(b.first_seen || "");
    case "last_updated":
      return Date.parse(a.last_updated || "") - Date.parse(b.last_updated || "");
    default:
      return 0;
  }
}

function hostMatchesFilter(host: HostObservation, state: DeviceState, needle: string) {
  return [
    host.ip,
    host.hostname || "",
    host.mac_address || "",
    host.vendor || "",
    host.device_type,
    state,
    formatPorts(host.open_ports),
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function TableView({ rows, states, hiddenCount }: { rows: HostObservation[]; states: Record<string, DeviceState>; hiddenCount: number }) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("ip");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedIP, setSelectedIP] = useState("");
  // Selection survives filtering (the panel stays open while narrowing), but
  // closes when the host disappears from the results entirely.
  const selected = rows.find((host) => host.ip === selectedIP);

  function toggleSelect(ip: string) {
    setSelectedIP((current) => (current === ip ? "" : ip));
  }

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = needle ? rows.filter((host) => hostMatchesFilter(host, states[host.ip] || "stable", needle)) : rows;
    const sorted = [...filtered].sort((a, b) => {
      const order = compareHosts(a, b, sortKey, states) || compareIP(a.ip, b.ip);
      return sortAsc ? order : -order;
    });
    return sorted;
  }, [rows, states, filter, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortAsc((asc) => !asc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  return (
    <section className={`tableLayout ${selected ? "withDetail" : ""}`} aria-label="Scan results">
      <div className="tableWrap">
      <div className="tableTools">
        <input
          className="tableFilter"
          type="search"
          placeholder="Filter by IP, hostname, MAC, vendor, port…"
          aria-label="Filter scan results"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {filter.trim() && (
          <span className="quiet">
            {visible.length} of {rows.length} match
          </span>
        )}
      </div>
      <table>
        <thead>
          <tr>
            {TABLE_COLUMNS.map((column) => (
              <th
                key={column.key}
                aria-sort={sortKey === column.key ? (sortAsc ? "ascending" : "descending") : undefined}
              >
                <button type="button" className="sortHeader" onClick={() => toggleSort(column.key)}>
                  {column.label}
                  {sortKey === column.key && <span className="sortArrow" aria-hidden="true">{sortAsc ? "▲" : "▼"}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((host) => (
            <tr
              key={host.ip}
              className={`hostRow ${selectedIP === host.ip ? "selected" : ""}`}
              tabIndex={0}
              onClick={() => toggleSelect(host.ip)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleSelect(host.ip);
                }
              }}
            >
              <td>{host.ip}</td>
              <td title={host.hostname || undefined}>{host.hostname || ""}</td>
              <td>{host.mac_address || ""}</td>
              <td title={host.vendor || undefined}>{host.vendor || ""}</td>
              <td><StatePill state={states[host.ip] || "stable"} /></td>
              <td>{host.alive ? "yes" : "no"}</td>
              <td title={formatPorts(host.open_ports) || undefined}>{formatPorts(host.open_ports)}</td>
              <td>{host.device_type}</td>
              <td>{formatTime(host.first_seen)}</td>
              <td>{formatTime(host.last_updated)}</td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td className="empty" colSpan={10}>
                {rows.length > 0
                  ? "No hosts match the filter."
                  : hiddenCount > 0
                    ? `${hiddenCount} unresponsive hosts hidden.`
                    : "No scan results yet. Enter a CIDR and press Start Scan."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      {selected && (
        <DeviceDetail host={selected} state={states[selected.ip]} onClose={() => setSelectedIP("")} />
      )}
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

function HistoryView({
  history,
  diff,
  onRefresh,
  onError,
}: {
  history: ScanRun[];
  diff: ScanDiff;
  onRefresh: () => void;
  onError: (err: unknown) => void;
}) {
  const [baseID, setBaseID] = useState("");
  const [compareID, setCompareID] = useState("");
  const [customDiff, setCustomDiff] = useState<ScanDiff | null>(null);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [busy, setBusy] = useState(false);

  const shownDiff = customDiff || diff;
  const canCompare = Boolean(baseID && compareID && baseID !== compareID);

  async function compareRuns() {
    const app = window.go?.main?.App;
    if (!app || !canCompare) return;
    setBusy(true);
    try {
      setCustomDiff(await app.DiffRuns(baseID, compareID));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function deleteRun(runID: string) {
    const app = window.go?.main?.App;
    if (!app) return;
    setBusy(true);
    try {
      await app.DeleteRun(runID);
      setConfirmDelete("");
      if (runID === baseID) setBaseID("");
      if (runID === compareID) setCompareID("");
      if (customDiff && (customDiff.base_run_id === runID || customDiff.compare_run_id === runID)) {
        setCustomDiff(null);
      }
      onRefresh();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="historyWrap" aria-label="Scan history">
      <div className="historyHeader">
        <h2>Scan history</h2>
        <button onClick={onRefresh}>Refresh</button>
      </div>
      <div className="historyGrid">
        <section className="historyPanel">
          <h3>Runs</h3>
          {history.length > 1 && (
            <p className="quiet">Mark a run A and another B to compare them; A is the older baseline.</p>
          )}
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
              <div className="runActions">
                <label className="runPick" title="Compare from (baseline)">
                  <input type="radio" name="diff-base" checked={baseID === run.id} onChange={() => setBaseID(run.id)} />
                  <span>A</span>
                </label>
                <label className="runPick" title="Compare to">
                  <input
                    type="radio"
                    name="diff-compare"
                    checked={compareID === run.id}
                    onChange={() => setCompareID(run.id)}
                  />
                  <span>B</span>
                </label>
                {confirmDelete === run.id ? (
                  <button className="small danger" onClick={() => deleteRun(run.id)} disabled={busy}>
                    Confirm
                  </button>
                ) : (
                  <button
                    className="small"
                    onClick={() => setConfirmDelete(run.id)}
                    disabled={busy}
                    aria-label={`Delete run from ${new Date(run.started_at).toLocaleString()}`}
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
          {history.length === 0 && <p className="quiet">No saved scan runs yet.</p>}
        </section>

        <section className="historyPanel">
          <div className="diffHeader">
            <h3>{customDiff ? "Comparing A → B" : "Latest diff"}</h3>
            <div className="buttonRow">
              <button className="small" onClick={compareRuns} disabled={busy || !canCompare}>
                Compare A → B
              </button>
              {customDiff && (
                <button className="small" onClick={() => setCustomDiff(null)}>
                  Back to latest
                </button>
              )}
            </div>
          </div>
          {!customDiff && history.length < 2 && <p className="quiet">Run two scans to compare history.</p>}
          {(customDiff || history.length >= 2) && <DiffColumns diff={shownDiff} />}
        </section>
      </div>
    </section>
  );
}

function DiffColumns({ diff }: { diff: ScanDiff }) {
  const newHosts = diff.new_hosts || [];
  const missingHosts = diff.missing_hosts || [];
  const changedHosts = diff.changed_hosts || [];
  return (
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
  );
}

function DeviceDetail({ host, state = "stable", onClose }: { host?: HostObservation; state?: DeviceState; onClose?: () => void }) {
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
            <div className="detailTitle">
              <h2>{host.hostname || host.ip}</h2>
              {onClose && (
                <button className="detailClose" onClick={onClose} aria-label="Close details">
                  ×
                </button>
              )}
            </div>
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

// formatTime keeps today's observations short (time only) but never hides the
// date of older ones — "First seen" on a device from last week must not read
// like this morning.
function formatTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
  return `${day} ${time}`;
}

// isValidCIDR mirrors the backend's scanner.ValidateCIDR closely enough for
// live feedback; the backend stays the source of truth when the scan starts.
function isValidCIDR(value: string) {
  const match = value.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!match) return false;
  if (match.slice(1, 5).some((octet) => Number(octet) > 255)) return false;
  return Number(match[5]) <= 32;
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
