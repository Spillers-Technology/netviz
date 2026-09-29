// Types and pure helpers shared by the desktop app and the server web UI.

export type PortObservation = {
  port: number;
  service: string;
};

export type HostObservation = {
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

export type ScanRun = {
  id: string;
  cidr: string;
  started_at: string;
  ended_at?: string;
  host_count: number;
  alive_count: number;
  open_port_count: number;
};

export type HostHistoryEntry = {
  run_id: string;
  started_at: string;
  ended_at: string;
  host: HostObservation;
};

// DeviceState is the monitor-mode transition a device went through in the
// latest pass; "stable" means nothing to call out.
export type DeviceState = "new" | "online" | "offline" | "changed" | "stable";

export const CATEGORY_ORDER = [
  "firewall/network",
  "windows/smb",
  "linux/iot",
  "apple",
  "printer",
  "camera/media",
  "web appliance",
  "unknown",
] as const;

export type Category = (typeof CATEGORY_ORDER)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  "firewall/network": "Network gear",
  "windows/smb": "Windows",
  "linux/iot": "Linux and IoT",
  apple: "Apple",
  printer: "Printers",
  "camera/media": "Cameras and media",
  "web appliance": "Web appliances",
  unknown: "Unidentified",
};

export function categoryFor(host: HostObservation): Category {
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

export function compareIP(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 4; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

// textCompare sorts case-insensitively with blanks last, so sorting by
// hostname doesn't pin every no-hostname address to the top.
export function textCompare(a: string, b: string) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function formatPorts(ports: PortObservation[]) {
  return ports.map((port) => `${port.port}/${port.service}`).join(", ");
}

// formatTime keeps today's observations short (time only) but never hides the
// date of older ones — "First seen" on a device from last week must not read
// like this morning.
export function formatTime(value: string, now = new Date()) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
  return `${day} ${time}`;
}

export function formatAge(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

// isValidCIDR mirrors the backend's scanner.ValidateCIDR closely enough for
// live feedback; the backend stays the source of truth when the scan starts.
export function isValidCIDR(value: string) {
  const match = value.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!match) return false;
  if (match.slice(1, 5).some((octet) => Number(octet) > 255)) return false;
  return Number(match[5]) <= 32;
}

// normalizeHost guards against hosts arriving over the wire with null or
// missing fields (JSON null for an empty Go slice, older saved scan files);
// every view indexes open_ports directly.
export function normalizeHost(host: HostObservation): HostObservation {
  return {
    ...host,
    open_ports: Array.isArray(host.open_ports) ? host.open_ports : [],
    device_type: host.device_type || "unknown",
  };
}

export function hostLabel(host: HostObservation) {
  return host.hostname || host.vendor || host.ip;
}

export function hostMatchesFilter(host: HostObservation, state: DeviceState | undefined, needle: string) {
  if (!needle) return true;
  return [
    host.ip,
    host.hostname || "",
    host.mac_address || "",
    host.vendor || "",
    host.device_type,
    CATEGORY_LABEL[categoryFor(host)],
    state || "",
    host.alive ? "up" : "down",
    formatPorts(host.open_ports),
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle.trim().toLowerCase());
}

export function hasResponseSignal(host: HostObservation) {
  return host.alive || host.open_ports.length > 0 || Boolean(host.mac_address);
}

export function hostChanged(previous: HostObservation, next: HostObservation) {
  return (
    previous.hostname !== next.hostname ||
    previous.mac_address !== next.mac_address ||
    previous.vendor !== next.vendor ||
    previous.device_type !== next.device_type ||
    formatPorts(previous.open_ports) !== formatPorts(next.open_ports)
  );
}

export function classifyTransition(previous: HostObservation | undefined, next: HostObservation): DeviceState {
  const previousActive = previous ? hasResponseSignal(previous) : false;
  const nextActive = hasResponseSignal(next);
  if (!previous && nextActive) return "new";
  if (previousActive && !nextActive) return "offline";
  if (!previousActive && nextActive) return "online";
  if (previous && nextActive && hostChanged(previous, next)) return "changed";
  return "stable";
}

export function isVisuallyActive(host: HostObservation) {
  return host.alive || host.open_ports.length > 0 || Boolean(host.mac_address || host.vendor || host.hostname);
}

// shouldShowHost hides addresses that were checked but never answered, unless
// the user asked for them or a monitor pass has something to say about them.
export function shouldShowHost(host: HostObservation, state: DeviceState = "stable", showUnresponsive: boolean) {
  if (showUnresponsive) return true;
  if (state !== "stable") return true;
  return isVisuallyActive(host);
}

// parsePortList accepts "8006, 9443 10000" and keeps only valid, unique TCP
// ports; everything else is dropped so typing never errors.
export function parsePortList(text: string): number[] {
  const ports = new Set<number>();
  for (const token of text.split(/[\s,;]+/)) {
    if (!/^\d{1,5}$/.test(token)) continue;
    const port = Number(token);
    if (port >= 1 && port <= 65535) ports.add(port);
  }
  return [...ports];
}

// deviceSummary is the plain-text block "Copy details" puts on the
// clipboard, ready to paste into a ticket.
export function deviceSummary(host: HostObservation, state?: DeviceState) {
  const lines = [
    `${hostLabel(host)} (${host.ip})`,
    `Type: ${CATEGORY_LABEL[categoryFor(host)]} (${host.device_type})`,
    `Status: ${host.alive ? "Up" : "Not answering"}${state && state !== "stable" ? `, ${state} in the latest pass` : ""}`,
  ];
  if (host.hostname) lines.push(`Hostname: ${host.hostname}`);
  if (host.mac_address) lines.push(`MAC: ${host.mac_address}`);
  if (host.vendor) lines.push(`Vendor: ${host.vendor}`);
  lines.push(`Open ports: ${host.open_ports.length ? formatPorts(host.open_ports) : "none of the scanned ports"}`);
  if (host.first_seen) lines.push(`First seen: ${new Date(host.first_seen).toLocaleString()}`);
  if (host.last_updated) lines.push(`Last seen: ${new Date(host.last_updated).toLocaleString()}`);
  return lines.join("\n");
}
