import type { Device, ServerState } from "./types";

// Deterministic PRNG so the demo network is stable across reloads.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Blueprint = {
  count: number;
  device_type: string;
  ports: number[][];
  names: string[];
  vendors: string[];
};

const blueprints: Blueprint[] = [
  {
    count: 2,
    device_type: "network_device",
    ports: [[53, 443], [53, 80, 443]],
    names: ["gateway", "switch-core"],
    vendors: ["Ubiquiti", "MikroTik"],
  },
  {
    count: 9,
    device_type: "windows_or_smb",
    ports: [[445], [445, 3389], [135, 445]],
    names: ["ws-front", "ws-shop", "ws-lab", "dc01", "ws-sales"],
    vendors: ["Dell Inc.", "LENOVO", "Micro-Star"],
  },
  {
    count: 11,
    device_type: "linux_or_iot",
    ports: [[22], [22, 80], [1883], []],
    names: ["pi-hole", "node-red", "sensor", "relay", "nas"],
    vendors: ["Raspberry Pi", "Espressif", "Synology"],
  },
  {
    count: 5,
    device_type: "apple_device",
    ports: [[], [7000]],
    names: ["macbook", "iphone", "appletv"],
    vendors: ["Apple, Inc."],
  },
  {
    count: 3,
    device_type: "printer",
    ports: [[9100], [631, 9100]],
    names: ["print-front", "print-lab"],
    vendors: ["HP", "Brother"],
  },
  {
    count: 4,
    device_type: "camera_or_rtsp",
    ports: [[554], [554, 80]],
    names: ["cam-door", "cam-lot", "cam-dock"],
    vendors: ["Hikvision", "Reolink"],
  },
  {
    count: 4,
    device_type: "web_device",
    ports: [[80], [443], [80, 443]],
    names: ["octoprint", "unifi", "grafana"],
    vendors: ["Ubiquiti", ""],
  },
  {
    count: 14,
    device_type: "unknown",
    ports: [[]],
    names: ["", "", "guest"],
    vendors: ["", "", "Samsung"],
  },
];

export function demoState(): ServerState {
  const rand = mulberry32(1177);
  const devices: Device[] = [];
  let lastOctet = 1;
  const now = Date.now();

  for (const blueprint of blueprints) {
    for (let i = 0; i < blueprint.count; i++) {
      const ip = `192.168.1.${lastOctet}`;
      lastOctet += 1 + Math.floor(rand() * 4);
      const ports = blueprint.ports[Math.floor(rand() * blueprint.ports.length)];
      const name = blueprint.names[Math.floor(rand() * blueprint.names.length)];
      const alive = blueprint.device_type === "unknown" ? rand() < 0.35 : rand() < 0.92;
      devices.push({
        ip,
        hostname: name ? `${name}${i > 0 ? "-" + i : ""}.lan` : "",
        mac_address: `aa:5c:${hexPair(rand)}:${hexPair(rand)}:${hexPair(rand)}:${hexPair(rand)}`,
        vendor: blueprint.vendors[Math.floor(rand() * blueprint.vendors.length)],
        alive,
        open_ports: (alive ? ports : []).map((port) => ({ port, service: serviceName(port) })),
        device_type: blueprint.device_type,
        first_seen: new Date(now - 86_400_000 * (1 + rand() * 30)).toISOString(),
        last_updated: new Date(now - 60_000 * rand() * 10).toISOString(),
      });
    }
  }

  return {
    version: "demo",
    probe: {
      last_seen: new Date(now - 42_000).toISOString(),
      version: "demo",
      cidr: "192.168.1.0/24",
      status: "ok",
    },
    run: {
      id: "demo-run",
      cidr: "192.168.1.0/24",
      started_at: new Date(now - 95_000).toISOString(),
      ended_at: new Date(now - 60_000).toISOString(),
      host_count: devices.length,
      alive_count: devices.filter((device) => device.alive).length,
      open_port_count: devices.reduce((sum, device) => sum + device.open_ports.length, 0),
    },
    devices,
  };
}

function hexPair(rand: () => number) {
  return Math.floor(rand() * 256).toString(16).padStart(2, "0");
}

function serviceName(port: number) {
  const services: Record<number, string> = {
    22: "ssh",
    53: "dns",
    80: "http",
    135: "msrpc",
    443: "https",
    445: "smb",
    554: "rtsp",
    631: "ipp",
    1883: "mqtt",
    3389: "rdp",
    7000: "airplay",
    9100: "jetdirect",
  };
  return services[port] || "";
}
