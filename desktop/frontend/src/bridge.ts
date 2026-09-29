import type { HostHistoryEntry, HostObservation, PortObservation, ScanRun } from "@netviz/ui";

// Typed access to the Go backend through the Wails bridge. Every call goes
// through app(), which fails loudly if the bridge is missing instead of
// quietly doing nothing.

export type HostChange = {
  ip: string;
  before: HostObservation;
  after: HostObservation;
  hostname_changed: boolean;
  mac_changed: boolean;
  vendor_changed: boolean;
  ports_changed: boolean;
  device_type_changed: boolean;
};

export type ScanDiff = {
  base_run_id: string;
  compare_run_id: string;
  new_hosts?: HostObservation[];
  missing_hosts?: HostObservation[];
  changed_hosts?: HostChange[];
};

export type ProbeConfigState = {
  cidr: string;
  anchordesk_url: string;
  probe_key: string;
  interval: string;
  config_path: string;
};

export type ProbeServiceStatus = {
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

export type ProbeSetupRequest = {
  cidr: string;
  anchordesk_url: string;
  probe_key: string;
  interval: string;
  probe_path: string;
  install_persistent: boolean;
  start_after_install: boolean;
};

export type UpdateInfo = {
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

export type ScanEvent = {
  type: string;
  ip?: string;
  host?: HostObservation;
  checked_hosts?: number;
  total_hosts?: number;
};

type AppBindings = {
  StartScan(cidr: string, ports: number[]): Promise<void>;
  StartMonitorScan(cidr: string, ports: number[]): Promise<void>;
  CancelScan(): Promise<void>;
  DefaultPorts(): Promise<PortObservation[]>;
  DetectNetworks?(): Promise<string[]>;
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

declare global {
  interface Window {
    go?: { main?: { App?: AppBindings } };
    runtime?: {
      EventsOn(name: string, callback: (payload: unknown) => void): (() => void) | void;
    };
  }
}

export function hasBridge() {
  return Boolean(window.go?.main?.App);
}

export function app(): AppBindings {
  const bindings = window.go?.main?.App;
  if (!bindings) {
    throw new Error("NetViz's desktop backend isn't connected. Restart NetViz; if this keeps happening, reinstall it.");
  }
  return bindings;
}

export function onEvent(name: string, callback: (payload: unknown) => void): () => void {
  const off = window.runtime?.EventsOn(name, callback);
  return typeof off === "function" ? off : () => {};
}

export const emptyDiff: ScanDiff = { base_run_id: "", compare_run_id: "" };
