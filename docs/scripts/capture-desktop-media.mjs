#!/usr/bin/env node
// Captures product screenshots of the NetViz desktop app for the docs/Pages site.
//
// The desktop frontend is a React app that talks to its Go backend through the
// Wails bridge: window.go.main.App.* method calls and window.runtime.EventsOn
// event subscriptions. There is no HTTP API to intercept, so instead of routing
// network requests (the way the AnchorDesk web capture does) we inject a mock
// Wails bridge with addInitScript, then replay a realistic scan by invoking the
// captured "scan:event" handler with mocked hosts.
//
// Usage:
//   cd desktop/frontend && npm run dev        # serves the app on 127.0.0.1:5173
//   node docs/scripts/capture-desktop-media.mjs
//
// Playwright is loaded from PLAYWRIGHT_NODE_MODULES if set, otherwise from a few
// common locations. See loadPlaywright() for the install hint.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outDir = path.join(repoRoot, "docs", "assets");
const baseUrl = process.env.NETVIZ_CAPTURE_BASE_URL || "http://127.0.0.1:5173";
const debugCapture = process.env.NETVIZ_CAPTURE_DEBUG === "1";

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_NODE_MODULES
      ? path.join(process.env.PLAYWRIGHT_NODE_MODULES, "playwright")
      : null,
    path.join(repoRoot, "desktop", "frontend", "node_modules", "playwright"),
    "playwright",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try the next location
    }
  }

  throw new Error(
    [
      "Playwright is required to capture product media.",
      "Install it in a temp directory, then point PLAYWRIGHT_NODE_MODULES at that node_modules folder:",
      "  npm install --prefix %TEMP%\\netviz-playwright playwright",
      "  npx --prefix %TEMP%\\netviz-playwright playwright install chromium",
      "  $env:PLAYWRIGHT_NODE_MODULES=\"$env:TEMP\\netviz-playwright\\node_modules\"",
      "Start the desktop frontend first: cd desktop/frontend; npm run dev",
      "  node docs/scripts/capture-desktop-media.mjs",
    ].join("\n")
  );
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function daysAgo(days, hour = 10, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const port = (p, service) => ({ port: p, service });

// A realistic home/office /24. Every host carries a `state` field describing the
// monitor-mode state it should end in; the capture drives a baseline pass and a
// monitor pass so the State column shows the real new/online/offline/changed/
// stable transitions rather than a wall of one value.
const hosts = [
  {
    ip: "192.168.1.1", hostname: "gateway.local", mac_address: "b8:27:eb:1a:4c:70",
    vendor: "Ubiquiti Inc", device_type: "network_device", state: "stable",
    open_ports: [port(53, "dns"), port(80, "http"), port(443, "https")],
  },
  {
    ip: "192.168.1.10", hostname: "nas.local", mac_address: "00:11:32:6d:2a:11",
    vendor: "Synology Incorporated", device_type: "web_device", state: "stable",
    open_ports: [port(80, "http"), port(443, "https"), port(445, "smb"), port(5900, "vnc")],
  },
  {
    ip: "192.168.1.14", hostname: "unifi-ap-office", mac_address: "78:8a:20:33:c1:a2",
    vendor: "Ubiquiti Inc", device_type: "network_device", state: "stable",
    open_ports: [port(22, "ssh"), port(80, "http"), port(443, "https")],
  },
  {
    ip: "192.168.1.20", hostname: "studio-pc", mac_address: "3c:7c:3f:0b:9e:41",
    vendor: "ASUSTek COMPUTER INC.", device_type: "windows_or_smb", state: "stable",
    open_ports: [port(135, "msrpc"), port(139, "netbios"), port(445, "smb"), port(3389, "rdp")],
  },
  {
    ip: "192.168.1.23", hostname: "reception-pc", mac_address: "d8:cb:8a:71:20:04",
    vendor: "Micro-Star INTL CO., LTD.", device_type: "windows_rdp", state: "online",
    open_ports: [port(135, "msrpc"), port(445, "smb"), port(3389, "rdp")],
  },
  {
    ip: "192.168.1.30", hostname: "macbook-jess", mac_address: "a4:83:e7:52:9d:88",
    vendor: "Apple, Inc.", device_type: "apple_device", state: "stable",
    open_ports: [port(22, "ssh"), port(5900, "vnc")],
  },
  {
    ip: "192.168.1.42", hostname: "pihole", mac_address: "dc:a6:32:44:19:5b",
    vendor: "Raspberry Pi Trading Ltd", device_type: "linux_or_iot", state: "changed",
    open_ports: [port(22, "ssh"), port(53, "dns"), port(80, "http")],
    // A port opened since the last cycle; drives the "changed" state.
    added_port: port(443, "https"),
  },
  {
    ip: "192.168.1.50", hostname: "homeassistant", mac_address: "dc:a6:32:71:0e:2f",
    vendor: "Raspberry Pi Trading Ltd", device_type: "iot_device", state: "stable",
    open_ports: [port(22, "ssh"), port(1883, "mqtt"), port(8123, "home-assistant")],
  },
  {
    ip: "192.168.1.64", hostname: "hp-color-mfp", mac_address: "3c:d9:2b:0a:77:19",
    vendor: "Hewlett Packard", device_type: "printer", state: "stable",
    open_ports: [port(80, "http"), port(515, "lpd"), port(631, "ipp"), port(9100, "jetdirect")],
  },
  {
    ip: "192.168.1.72", hostname: "front-door-cam", mac_address: "e0:50:8b:12:6a:c4",
    vendor: "Hangzhou Hikvision Digital", device_type: "camera_or_rtsp", state: "stable",
    open_ports: [port(80, "http"), port(554, "rtsp")],
  },
  {
    ip: "192.168.1.80", hostname: "plex-server", mac_address: "00:1a:2b:9f:33:77",
    vendor: "Intel Corporate", device_type: "plex", state: "stable",
    open_ports: [port(32400, "plex"), port(8443, "https-alt")],
  },
  {
    ip: "192.168.1.91", hostname: "dev-vm", mac_address: "52:54:00:8a:11:2c",
    vendor: "Realtek Semiconductor", device_type: "ssh_device", state: "stable",
    open_ports: [port(22, "ssh"), port(8080, "http-alt")],
  },
  {
    ip: "192.168.1.104", hostname: "conf-room-tv", mac_address: "b0:a7:37:2e:55:90",
    vendor: "LG Electronics", device_type: "web_device", state: "stable",
    open_ports: [port(80, "http"), port(8080, "http-alt")],
  },
  {
    ip: "192.168.1.118", hostname: "office-switch", mac_address: "f4:e9:d4:22:8b:01",
    vendor: "Netgear", device_type: "network_device", state: "stable",
    open_ports: [port(80, "http"), port(443, "https")],
  },
  {
    ip: "192.168.1.150", hostname: "warehouse-tablet", mac_address: "40:4e:36:9c:1d:e8",
    vendor: "HTC Corporation", device_type: "linux_or_iot", state: "offline",
    open_ports: [port(8080, "http-alt")],
  },
  {
    // Not present in the baseline pass, so it lands as a "new" device.
    ip: "192.168.1.166", hostname: "guest-laptop", mac_address: "ac:de:48:00:11:22",
    vendor: "Dell Inc.", device_type: "windows_or_smb", state: "new",
    open_ports: [port(135, "msrpc"), port(445, "smb")],
  },
];

function hostObservation(host, { active = true, ports = host.open_ports } = {}) {
  return {
    ip: host.ip,
    hostname: active ? host.hostname : "",
    mac_address: active ? host.mac_address : "",
    vendor: active ? host.vendor : "",
    alive: active,
    open_ports: active ? ports : [],
    device_type: active ? host.device_type : "unknown",
    first_seen: daysAgo(6, 9, 12),
    last_updated: minutesAgo(1),
  };
}

// History timeline shown in the device detail panel, keyed by IP.
const hostHistory = {
  "192.168.1.42": [
    { run_id: "r5", started_at: minutesAgo(2), ended_at: minutesAgo(1), ports: [22, 53, 80, 443] },
    { run_id: "r4", started_at: minutesAgo(32), ended_at: minutesAgo(31), ports: [22, 53, 80] },
    { run_id: "r3", started_at: daysAgo(1, 18, 4), ended_at: daysAgo(1, 18, 5), ports: [22, 53, 80] },
    { run_id: "r2", started_at: daysAgo(3, 9, 40), ended_at: daysAgo(3, 9, 41), ports: [22, 53] },
  ],
  "192.168.1.1": [
    { run_id: "r5", started_at: minutesAgo(2), ended_at: minutesAgo(1), ports: [53, 80, 443] },
    { run_id: "r3", started_at: daysAgo(2, 8, 15), ended_at: daysAgo(2, 8, 16), ports: [53, 80, 443] },
  ],
};

function historyEntries(ip) {
  const entries = hostHistory[ip];
  if (!entries) return [];
  return entries.map((entry) => ({
    run_id: entry.run_id,
    started_at: entry.started_at,
    ended_at: entry.ended_at,
    host: {
      ip,
      alive: true,
      open_ports: entry.ports.map((p) => port(p, "tcp")),
      device_type: "linux_or_iot",
      first_seen: entry.started_at,
      last_updated: entry.ended_at,
    },
  }));
}

const historyRuns = [
  { id: "r5", cidr: "192.168.1.0/24", started_at: minutesAgo(2), ended_at: minutesAgo(1), host_count: 254, alive_count: 16, open_port_count: 41 },
  { id: "r4", cidr: "192.168.1.0/24", started_at: minutesAgo(32), ended_at: minutesAgo(31), host_count: 254, alive_count: 15, open_port_count: 38 },
  { id: "r3", cidr: "192.168.1.0/24", started_at: daysAgo(1, 18, 4), ended_at: daysAgo(1, 18, 6), host_count: 254, alive_count: 15, open_port_count: 37 },
  { id: "r2", cidr: "192.168.1.0/24", started_at: daysAgo(3, 9, 40), ended_at: daysAgo(3, 9, 42), host_count: 254, alive_count: 14, open_port_count: 34 },
  { id: "r1", cidr: "192.168.1.0/24", started_at: daysAgo(6, 9, 12), ended_at: daysAgo(6, 9, 14), host_count: 254, alive_count: 13, open_port_count: 30 },
];

const latestDiff = {
  base_run_id: "r4",
  compare_run_id: "r5",
  new_hosts: [hostObservation(hosts.find((h) => h.ip === "192.168.1.166"))],
  missing_hosts: [hostObservation(hosts.find((h) => h.ip === "192.168.1.150"), { active: false })],
  changed_hosts: [
    { ip: "192.168.1.42", hostname_changed: false, mac_changed: false, vendor_changed: false, ports_changed: true, device_type_changed: false },
    { ip: "192.168.1.23", hostname_changed: false, mac_changed: false, vendor_changed: false, ports_changed: true, device_type_changed: false },
  ],
};

const probeStatus = {
  probe_path: "C:/Program Files/NetViz/netviz-probe.exe",
  install_path: "C:/Program Files/NetViz/netviz-probe.exe",
  config_path: "C:/ProgramData/NetViz/probe.yaml",
  config: {
    cidr: "192.168.1.0/24",
    anchordesk_url: "https://rmm.example.com",
    probe_key: "pk_live_9f3c2a17",
    interval: "1m",
    config_path: "C:/ProgramData/NetViz/probe.yaml",
  },
  found: true,
  state: "running",
  severity: "success",
  summary: "Probe service running",
  message: "The persistent probe service is active.",
  output: "netviz-probe.service - NetViz LAN probe\n   Active: active (running)\n   Last push: 2 hosts changed, 16 reported (200 OK)",
};

const updateInfo = {
  current_version: "v0.9.3",
  latest_version: "v0.9.3",
  available: false,
  release_url: "https://github.com/Spillers-Technology/netviz/releases/latest",
  asset_name: "netviz-v0.9.3-windows-amd64.zip",
  checksum_name: "netviz-v0.9.3-windows-amd64.zip.sha256",
  asset_url: "",
  checksum_url: "",
  download_path: "",
  message: "NetViz is up to date (v0.9.3).",
};

// Serialize the mock data into a bridge that mimics the Wails bindings. Runs in
// the page before the app's own scripts, so window.go / window.runtime exist by
// the time React mounts and subscribes.
function bridgeInitScript(payload) {
  return `(() => {
    const data = ${JSON.stringify(payload)};
    window.__netvizHandlers = {};
    window.runtime = {
      EventsOn(name, cb) { window.__netvizHandlers[name] = cb; return () => { delete window.__netvizHandlers[name]; }; },
      EventsEmit() {},
    };
    const app = {
      StartScan: async () => {}, StartMonitorScan: async () => {}, CancelScan: async () => {},
      SaveScanFile: async () => {}, OpenScanFile: async () => null, SaveCSVFile: async () => {},
      DefaultPorts: async () => data.defaultPorts,
      DiffRuns: async () => data.latestDiff,
      DeleteRun: async () => {},
      ListHistory: async () => data.historyRuns,
      LatestDiff: async () => data.latestDiff,
      HostHistory: async (ip) => data.hostHistory[ip] || [],
      ChooseProbeBinary: async () => "", GetProbeStatus: async () => data.probeStatus,
      ProvisionProbe: async () => data.probeStatus, ProbeServiceAction: async () => data.probeStatus,
      CheckForUpdate: async () => data.updateInfo, DownloadLatestUpdate: async () => data.updateInfo,
      OpenUpdateDownload: async () => {}, ApplyDownloadedUpdate: async () => "",
    };
    window.go = { main: { App: app } };
  })();`;
}

function emitScript() {
  // Two passes: a baseline scan followed by a monitor pass, so the frontend's
  // own classifyTransition produces the real new/online/offline/changed/stable
  // states. Emitted from the page against the captured scan:event handler.
  return `(() => {
    const hosts = ${JSON.stringify(hosts)};
    const total = 254;
    const H = window.__netvizHandlers["scan:event"];
    const State = window.__netvizHandlers["scan:state"];
    const first = "${daysAgo(6, 9, 12)}";
    const now = "${minutesAgo(1)}";
    function obs(h, { active = true, ports } = {}) {
      return {
        ip: h.ip, hostname: active ? h.hostname : "", mac_address: active ? h.mac_address : "",
        vendor: active ? h.vendor : "", alive: active,
        open_ports: active ? (ports || h.open_ports) : [],
        device_type: active ? h.device_type : "unknown", first_seen: first, last_updated: now,
      };
    }
    if (State) State({ scanning: true });
    // Baseline pass (host_seen sets hosts without a transition state).
    for (const h of hosts) {
      if (h.state === "new") continue;
      if (h.state === "online") { H({ type: "host_seen", ip: h.ip, host: obs(h, { active: false }) }); continue; }
      if (h.state === "changed") { H({ type: "host_seen", ip: h.ip, host: obs(h) }); continue; }
      H({ type: "host_seen", ip: h.ip, host: obs(h) });
    }
    // Monitor pass (host_done drives the state pills).
    let checked = 0;
    for (const h of hosts) {
      checked += 1;
      let ev;
      if (h.state === "offline") ev = obs(h, { active: false });
      else if (h.state === "changed") ev = obs(h, { ports: h.open_ports.concat([h.added_port]) });
      else ev = obs(h);
      H({ type: "host_done", ip: h.ip, host: ev, checked_hosts: total, total_hosts: total });
    }
    H({ type: "scan_finished", checked_hosts: total, total_hosts: total });
    if (State) State({ scanning: false });
  })();`;
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${baseUrl}. Start it with: cd desktop/frontend && npm run dev`);
}

async function selectTab(page, label) {
  await page.locator(`nav.tabs button:has-text("${label}")`).click();
  await page.waitForTimeout(350);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = loadPlaywright();

  const defaultPorts = [
    [21, "ftp"], [22, "ssh"], [23, "telnet"], [53, "dns"], [80, "http"], [135, "msrpc"],
    [139, "netbios"], [443, "https"], [445, "smb"], [515, "lpd"], [554, "rtsp"], [631, "ipp"],
    [1883, "mqtt"], [3389, "rdp"], [5900, "vnc"], [8000, "http-alt"], [8080, "http-alt"],
    [8123, "home-assistant"], [8443, "https-alt"], [8888, "http-alt"], [9100, "jetdirect"], [32400, "plex"],
  ].map(([p, service]) => port(p, service));

  const payload = { historyRuns, latestDiff, hostHistory: buildHostHistory(), probeStatus, updateInfo, defaultPorts };

  let browser;
  try {
    console.log(`Using NetViz desktop frontend at ${baseUrl}...`);
    await waitForServer();
    console.log("Launching Chromium...");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1.5 });
    const page = await context.newPage();
    if (debugCapture) {
      page.on("console", (m) => console.log(`BROWSER ${m.type()}: ${m.text()}`));
      page.on("pageerror", (e) => console.log(`BROWSER pageerror: ${e.message}`));
    }
    await page.addInitScript(bridgeInitScript(payload));

    console.log("Loading app...");
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.addStyleTag({
      content: `*, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; caret-color: transparent !important; }`,
    });
    await page.locator("nav.tabs").waitFor({ timeout: 20_000 });

    console.log("Replaying scan...");
    await page.evaluate(emitScript());
    await page.locator("table tbody tr").first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);

    const shots = [
      {
        tab: "Table",
        file: "view-table.png",
        ready: () => page.locator("table tbody tr").nth(3).waitFor(),
        // Select a device so the screenshot shows the table's detail panel.
        after: async () => {
          await page.locator("tbody tr", { hasText: "192.168.1.42" }).click();
          await page.locator(".tableLayout .detailPanel").waitFor();
        },
      },
      { tab: "Graph", file: "view-graph.png", ready: () => page.locator(".deviceNode").first().waitFor() },
      { tab: "Hierarchy", file: "view-hierarchy.png", ready: () => page.locator(".circleNode").first().waitFor() },
      { tab: "History", file: "view-history.png", ready: () => page.getByText("Latest diff", { exact: false }).waitFor() },
      { tab: "Probe", file: "view-probe.png", ready: () => page.getByText("Probe setup", { exact: false }).waitFor() },
      { tab: "Update", file: "view-update.png", ready: () => page.getByText("Release Asset", { exact: false }).waitFor() },
    ];

    for (const shot of shots) {
      console.log(`Rendering ${shot.tab}...`);
      await selectTab(page, shot.tab);
      await shot.ready();
      if (shot.after) await shot.after();
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(outDir, shot.file) });
    }

    console.log(`Captured ${shots.length} screenshots in ${path.relative(repoRoot, outDir)}`);
  } finally {
    if (browser) await browser.close();
  }
}

function buildHostHistory() {
  const out = {};
  for (const ip of Object.keys(hostHistory)) out[ip] = historyEntries(ip);
  return out;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
