import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  classifyTransition,
  compareIP,
  friendlyError,
  isValidCIDR,
  normalizeHost,
  parsePortList,
  shouldShowHost,
  type DeviceState,
  type FriendlyError,
  type HostObservation,
  type PortObservation,
} from "@netviz/ui";
import { app, hasBridge, onEvent, type ScanEvent } from "../bridge";
import { MAX_PORTS, MONITOR_INTERVALS, readSetting, useStoredState } from "../settings";

const intArray = (raw: string) => {
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.filter((value) => Number.isInteger(value)) : undefined;
};

// useScan owns the scan lifecycle: the range, live results from scan events,
// monitor mode, port selection and scan files. It is the single source of
// truth for every network view.
export function useScan() {
  const [cidr, setCidr] = useStoredState("netviz.cidr", "", (raw) => raw);
  const [detected, setDetected] = useState<string[]>([]);
  const [hosts, setHosts] = useState<Record<string, HostObservation>>({});
  const [deviceStates, setDeviceStates] = useState<Record<string, DeviceState>>({});
  const [scanning, setScanning] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [checked, setChecked] = useState(0);
  const [total, setTotal] = useState(0);
  const [showUnresponsive, setShowUnresponsive] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [portDefs, setPortDefs] = useState<PortObservation[]>([]);
  const [portsError, setPortsError] = useState<FriendlyError | null>(null);
  const [monitorMs, setMonitorMs] = useStoredState("netviz.monitorMs", 15_000, (raw) => {
    const value = Number(raw);
    return MONITOR_INTERVALS.some((interval) => interval.ms === value) ? value : undefined;
  });
  const [disabledPorts, setDisabledPorts] = useStoredState<number[]>("netviz.disabledPorts", [], intArray, JSON.stringify);
  const [extraPorts, setExtraPorts] = useStoredState("netviz.extraPorts", "", (raw) => raw);

  // Refs mirror state for event handlers registered once at mount.
  const hostsRef = useRef<Record<string, HostObservation>>({});
  const monitoringRef = useRef(false);
  const scanningRef = useRef(false);
  const cidrRef = useRef(cidr);
  const portsRef = useRef<number[]>([]);
  useEffect(() => void (monitoringRef.current = monitoring), [monitoring]);
  useEffect(() => void (scanningRef.current = scanning), [scanning]);
  useEffect(() => void (cidrRef.current = cidr), [cidr]);

  const applyHostEvent = useCallback((event: ScanEvent) => {
    if (!event.host) return;
    const incoming = normalizeHost(event.host);
    const previous = hostsRef.current[incoming.ip];
    if (monitoringRef.current && event.type === "host_seen" && previous) return;
    hostsRef.current = { ...hostsRef.current, [incoming.ip]: incoming };
    setHosts(hostsRef.current);
    if (["host_done", "host_enriched", "port_open", "device_classified"].includes(event.type)) {
      const state = classifyTransition(previous, incoming);
      setDeviceStates((states) => ({ ...states, [incoming.ip]: state }));
    }
  }, []);

  const loadHosts = useCallback((opened: HostObservation[]) => {
    const next: Record<string, HostObservation> = {};
    for (const host of opened) next[host.ip] = normalizeHost(host);
    hostsRef.current = next;
    setHosts(next);
    setDeviceStates({});
    setChecked(0);
    setTotal(opened.length);
  }, []);

  useEffect(() => {
    if (!hasBridge()) {
      setError(friendlyError(new Error("NetViz's desktop backend isn't connected. Restart NetViz; if this keeps happening, reinstall it.")));
      return;
    }
    const bindings = app();
    bindings
      .DefaultPorts()
      .then((defs) => setPortDefs(defs || []))
      .catch((err) => setPortsError(friendlyError(err, "Loading the default port list")));
    // Start from the network this PC is on unless the user already chose one.
    Promise.resolve(bindings.DetectNetworks ? bindings.DetectNetworks() : [])
      .then((networks) => {
        const list = networks || [];
        setDetected(list);
        if (!readSetting("netviz.cidr")) setCidr(list[0] || "192.168.1.0/24");
      })
      .catch(() => {
        if (!readSetting("netviz.cidr")) setCidr("192.168.1.0/24");
      });

    const offs = [
      onEvent("scan:event", (payload) => {
        const event = payload as ScanEvent;
        if (event.host) applyHostEvent(event);
        if (event.checked_hosts !== undefined) setChecked(event.checked_hosts);
        if (event.total_hosts !== undefined) setTotal(event.total_hosts);
        if (event.type === "scan_finished") {
          setScanning(false);
          scanningRef.current = false;
        }
      }),
      onEvent("scan:state", (payload) => {
        const state = payload as { scanning?: boolean };
        if (typeof state.scanning === "boolean") {
          setScanning(state.scanning);
          scanningRef.current = state.scanning;
        }
      }),
      onEvent("scan:loaded", (payload) => loadHosts((payload as HostObservation[]) || [])),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => Object.values(hosts).sort((a, b) => compareIP(a.ip, b.ip)), [hosts]);
  const visibleRows = useMemo(
    () => rows.filter((host) => shouldShowHost(host, deviceStates[host.ip], showUnresponsive)),
    [rows, deviceStates, showUnresponsive],
  );

  // With nothing customized an empty list is sent and the scanner uses its
  // defaults; a customized selection is sent explicitly.
  const extraPortList = useMemo(() => parsePortList(extraPorts), [extraPorts]);
  const portsCustomized = disabledPorts.length > 0 || extraPortList.length > 0;
  const scanPorts = useMemo(() => {
    if (!portsCustomized) return [];
    const enabled = portDefs.map((def) => def.port).filter((port) => !disabledPorts.includes(port));
    return [...new Set([...enabled, ...extraPortList])].sort((a, b) => a - b);
  }, [portsCustomized, portDefs, disabledPorts, extraPortList]);
  const portsValid = !portsCustomized || (scanPorts.length > 0 && scanPorts.length <= MAX_PORTS);
  useEffect(() => void (portsRef.current = scanPorts), [scanPorts]);

  const cidrValid = isValidCIDR(cidr);

  const startScan = useCallback(async (preserve = false, fromMonitor = false) => {
    setError(null);
    if (!preserve) {
      hostsRef.current = {};
      setHosts({});
      setDeviceStates({});
    }
    setChecked(0);
    setTotal(0);
    try {
      if (preserve) await app().StartMonitorScan(cidrRef.current.trim(), portsRef.current);
      else await app().StartScan(cidrRef.current.trim(), portsRef.current);
      setScanning(true);
      scanningRef.current = true;
    } catch (err) {
      setScanning(false);
      scanningRef.current = false;
      if (fromMonitor && !monitoringRef.current) return;
      setError(friendlyError(err, "Starting the scan"));
    }
  }, []);

  const cancel = useCallback(async () => {
    setMonitoring(false);
    monitoringRef.current = false;
    try {
      await app().CancelScan();
    } catch (err) {
      setError(friendlyError(err, "Cancelling the scan"));
    }
  }, []);

  const toggleMonitor = useCallback(async () => {
    const next = !monitoringRef.current;
    setMonitoring(next);
    monitoringRef.current = next;
    if (next && !scanningRef.current) await startScan(Object.keys(hostsRef.current).length > 0, true);
  }, [startScan]);

  useEffect(() => {
    if (!monitoring || scanning) return;
    const timer = window.setTimeout(() => void startScan(true, true), rows.length === 0 ? 100 : monitorMs);
    return () => window.clearTimeout(timer);
  }, [monitoring, scanning, rows.length, monitorMs, startScan]);

  const fileAction = useCallback(async (action: "open" | "save" | "csv") => {
    setError(null);
    try {
      if (action === "open") {
        const opened = await app().OpenScanFile();
        if (opened) loadHosts(opened);
        return Boolean(opened);
      }
      if (action === "save") await app().SaveScanFile();
      else await app().SaveCSVFile();
      return true;
    } catch (err) {
      setError(friendlyError(err, action === "open" ? "Opening the scan file" : action === "save" ? "Saving the scan" : "Exporting the CSV"));
      return false;
    }
  }, [loadHosts]);

  return {
    cidr,
    setCidr,
    cidrValid,
    detected,
    hosts,
    rows,
    visibleRows,
    deviceStates,
    scanning,
    monitoring,
    checked,
    total,
    showUnresponsive,
    setShowUnresponsive,
    error,
    clearError: () => setError(null),
    monitorMs,
    setMonitorMs,
    portDefs,
    portsError,
    disabledPorts,
    setDisabledPorts,
    extraPorts,
    setExtraPorts,
    scanPorts,
    portsCustomized,
    portsValid,
    startScan,
    cancel,
    toggleMonitor,
    fileAction,
  };
}

export type ScanState = ReturnType<typeof useScan>;
