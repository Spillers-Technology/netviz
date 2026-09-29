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
import { desktopProfiles, colorSchemes, chromiumArgs, trackErrors, captureView, assertCanvasPainted } from "./validation.mjs";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outDir = process.env.NETVIZ_CAPTURE_OUT_DIR || path.join(repoRoot, "docs", "assets", "workspaces");
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
  current_version: "v0.9.5",
  latest_version: "v0.9.5",
  available: false,
  release_url: "https://github.com/Spillers-Technology/netviz/releases/latest",
  asset_name: "netviz-v0.9.5-windows-amd64.zip",
  checksum_name: "netviz-v0.9.5-windows-amd64.zip.sha256",
  asset_url: "",
  checksum_url: "",
  download_path: "",
  message: "NetViz is up to date (v1.0.0).",
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
      DetectNetworks: async () => ["192.168.1.0/24"],
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

// A synthetic /22 (1,022 addresses, most answering) for the topology
// performance check; addresses are private and fictional.
function largeNetworkScript() {
  return `(() => {
    const H = window.__netvizHandlers["scan:event"];
    const types = ["network_device", "windows_or_smb", "linux_or_iot", "apple_device", "printer", "camera_or_rtsp", "web_device", "ssh_device"];
    const now = new Date().toISOString();
    for (let i = 1; i <= 1022; i += 1) {
      const ip = "10.20." + Math.floor(i / 256) + "." + (i % 256);
      const alive = i % 6 !== 0;
      const ports = alive && i % 3 !== 0 ? [{ port: 22 + (i % 9), service: "tcp" }, ...(i % 4 === 0 ? [{ port: 443, service: "https" }] : [])] : [];
      H({ type: "host_seen", ip, host: { ip, hostname: alive ? "host-" + i : "", mac_address: alive ? "02:00:00:00:" + (i >> 8).toString(16).padStart(2, "0") + ":" + (i & 255).toString(16).padStart(2, "0") : "", vendor: "", alive, open_ports: ports, device_type: alive ? types[i % types.length] : "unknown", first_seen: now, last_updated: now } });
    }
    H({ type: "scan_finished", checked_hosts: 1022, total_hosts: 1022 });
  })();`;
}

const nav = (page, id) => page.locator(`[data-nav="${id}"]`).click();
const networkView = (page, name) => page.getByRole("button", { name, exact: true }).click();

async function settle(page) {
  await page.waitForTimeout(250);
}

// Published site images: the light, laptop-size captures of each workspace.
const PUBLISHED = {
  "devices.png": "view-devices.png",
  "groups.png": "view-groups.png",
  "topology.png": "view-topology.png",
  "history.png": "view-history.png",
  "probe.png": "view-probe.png",
  "settings.png": "view-settings.png",
};

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
  const publish = process.env.NETVIZ_PUBLISH_SCREENSHOTS === "1";

  let browser;
  try {
    console.log(`Using NetViz desktop frontend at ${baseUrl}...`);
    await waitForServer();
    browser = await chromium.launch({ headless: true, args: chromiumArgs });

    for (const profile of desktopProfiles) {
      for (const scheme of colorSchemes) {
        const tag = `${profile.name}-${scheme}`;
        // Published images are rendered at 1.5x (2160x1440) for sharp site and README screenshots.
        const scale = publish && profile.name === "desktop" ? 1.5 : 1;
        const context = await browser.newContext({ viewport: profile, deviceScaleFactor: scale, colorScheme: scheme, reducedMotion: "reduce" });
        const page = await context.newPage();
        const errors = trackErrors(page);
        if (debugCapture) page.on("console", (m) => console.log(`BROWSER ${m.type()}: ${m.text()}`));
        await page.addInitScript(bridgeInitScript(payload));
        await page.goto(baseUrl, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: "Start with a network" }).waitFor({ timeout: 20_000 });
        await captureView(page, errors, path.join(outDir, `desktop-${tag}-empty.png`));

        await page.evaluate(emitScript());
        await page.locator("tbody tr[data-ip]").first().waitFor({ timeout: 20_000 });
        await settle(page);

        // Devices, with a device selected so the detail panel shows.
        await page.locator('tbody tr[data-ip="192.168.1.42"]').click();
        await page.getByRole("complementary", { name: "Device details" }).getByText("Monitor cycles with no change").waitFor();
        await captureView(page, errors, path.join(outDir, `desktop-${tag}-devices.png`));

        await networkView(page, "Groups");
        await page.locator('section [data-ip="192.168.1.42"]').waitFor();
        await captureView(page, errors, path.join(outDir, `desktop-${tag}-groups.png`));

        await networkView(page, "Topology");
        await page.locator('[data-topology-ready="true"]').waitFor({ timeout: 30_000 });
        await page.waitForTimeout(600);
        await assertCanvasPainted(page);
        await captureView(page, errors, path.join(outDir, `desktop-${tag}-topology.png`));

        // Search carries across views and dims the map; leaving and coming
        // back keeps both the view and the search.
        const search = page.getByRole("searchbox", { name: "Find a device" });
        await search.fill("pihole");
        await networkView(page, "Devices");
        if ((await page.locator("tbody tr[data-ip]").count()) !== 1) throw new Error("Search didn't filter the device table");
        await networkView(page, "Groups");
        if ((await search.inputValue()) !== "pihole") throw new Error("Search lost between network views");
        await captureView(page, errors, path.join(outDir, `desktop-${tag}-filtered-groups.png`));

        await nav(page, "history");
        await page.getByRole("heading", { name: "What changed" }).waitFor();
        if (await page.getByRole("button", { name: /^Scan 192/ }).count()) throw new Error("Scan controls leaked into History");
        await settle(page);
        await captureView(page, errors, path.join(outDir, `desktop-${tag}-history.png`));

        await nav(page, "network");
        if ((await page.getByRole("button", { name: "Groups", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("Network view was not restored");
        if ((await search.inputValue()) !== "pihole") throw new Error("Search lost leaving the workspace");
        await search.fill("");

        await nav(page, "probe");
        await page.getByRole("heading", { name: "Connection" }).waitFor();
        await settle(page);
        await captureView(page, errors, path.join(outDir, `desktop-${tag}-probe.png`));

        await nav(page, "settings");
        await page.getByRole("heading", { name: "Updates" }).waitFor();
        await settle(page);
        await captureView(page, errors, path.join(outDir, `desktop-${tag}-settings.png`));

        // The confirm dialog for a destructive action lists what changes.
        await nav(page, "history");
        await page.getByRole("button", { name: /^Delete the scan from/ }).first().click();
        await page.getByRole("dialog").getByText("Delete this saved scan?").waitFor();
        await captureView(page, errors, path.join(outDir, `desktop-${tag}-confirm.png`));
        await page.getByRole("button", { name: "Cancel" }).click();

        if (publish && profile.name === "desktop" && scheme === "light") {
          for (const [from, to] of Object.entries(PUBLISHED)) {
            fs.copyFileSync(path.join(outDir, `desktop-${tag}-${from}`), path.join(repoRoot, "docs", "assets", to));
          }
        }
        if (publish && profile.name === "desktop" && scheme === "dark") {
          fs.copyFileSync(path.join(outDir, `desktop-${tag}-topology.png`), path.join(repoRoot, "docs", "assets", "view-topology-dark.png"));
        }
        await context.close();
        console.log(`Captured ${tag} desktop views`);
      }
    }

    // The flat map: what WebGL-less systems get, and a user choice.
    for (const scheme of colorSchemes) {
      const context = await browser.newContext({ viewport: desktopProfiles[0], colorScheme: scheme, reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = trackErrors(page);
      await page.addInitScript(bridgeInitScript(payload));
      await page.addInitScript("window.__netvizForceFlat = true;");
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Start with a network" }).waitFor();
      await page.evaluate(emitScript());
      await page.locator("tbody tr[data-ip]").first().waitFor();
      await networkView(page, "Topology");
      await page.locator('[data-topology-renderer="flat"]').waitFor();
      await page.getByText("The 3D map isn't available on this system").waitFor();
      await captureView(page, errors, path.join(outDir, `desktop-desktop-${scheme}-topology-flat.png`));
      await context.close();
    }
    console.log("Captured the flat-map fallback");

    // Topology at /22 scale: layout speed is gated in the unit tests; here the
    // full render is timed and reported. Software WebGL on CI runners is far
    // slower than a real GPU, so this number is a trend, not a gate.
    {
      const context = await browser.newContext({ viewport: desktopProfiles[0], colorScheme: "dark", reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = trackErrors(page);
      await page.addInitScript(bridgeInitScript(payload));
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Start with a network" }).waitFor();
      await page.evaluate(largeNetworkScript());
      await page.locator("tbody tr[data-ip]").first().waitFor();
      await networkView(page, "Topology");
      await page.locator('[data-topology-ready="true"]').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await assertCanvasPainted(page);
      const ms = await page.evaluate(() => window.__netvizTopology.bench(20));
      console.log(`Topology /22 (1,022 devices): ${ms.toFixed(1)} ms per full render (software WebGL)`);
      await captureView(page, errors, path.join(outDir, "desktop-desktop-dark-topology-large.png"));
      await context.close();
    }
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