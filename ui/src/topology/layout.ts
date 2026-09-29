import { CATEGORY_ORDER, categoryFor, compareIP, type Category, type HostObservation } from "../net";

// The topology is laid out on the ground plane (x, z) with height (y) used
// for exposure: a device with more open ports stands taller. The layout is a
// pure function of the host list — deterministic, collision-free by
// construction, and never drifting — so a device stays where the user last
// saw it unless the network itself changes.

export type TopologyNode = {
  host: HostObservation;
  category: Category;
  x: number;
  y: number;
  z: number;
  size: number;
  gateway: boolean;
};

export type TopologyCluster = {
  category: Category;
  x: number;
  z: number;
  radius: number;
  count: number;
  angle: number;
};

export type TopologyLayout = {
  nodes: TopologyNode[];
  clusters: TopologyCluster[];
  gateway: TopologyNode | null;
  ringRadius: number;
  extent: number;
};

const SPACING = 1.2;
const GAP = 1.6;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function nodeHeight(host: HostObservation) {
  if (host.open_ports.length > 0) return 0.45 + Math.min(host.open_ports.length, 8) * 0.24;
  return host.alive ? 0.35 : 0.14;
}

export function nodeSize(host: HostObservation) {
  if (host.open_ports.length > 0) return 0.32 + Math.min(host.open_ports.length, 8) * 0.016;
  return host.alive ? 0.27 : 0.16;
}

// pickGateway prefers network gear on the conventional router addresses
// (.1, then .254), then the lowest-addressed network device.
export function pickGateway(hosts: HostObservation[]) {
  const gear = hosts.filter((host) => categoryFor(host) === "firewall/network").sort((a, b) => compareIP(a.ip, b.ip));
  return gear.find((host) => host.ip.endsWith(".1")) || gear.find((host) => host.ip.endsWith(".254")) || gear[0] || null;
}

export function clusterRadius(count: number) {
  return SPACING * Math.sqrt(Math.max(count, 1)) + 0.7;
}

export function computeLayout(hosts: HostObservation[]): TopologyLayout {
  const gatewayHost = pickGateway(hosts);
  const groups = new Map<Category, HostObservation[]>();
  for (const host of hosts) {
    if (host === gatewayHost) continue;
    const category = categoryFor(host);
    const group = groups.get(category);
    if (group) group.push(host);
    else groups.set(category, [host]);
  }
  const present = CATEGORY_ORDER.filter((category) => groups.has(category));

  // Size the ring so clusters sit side by side without overlapping, each
  // taking arc in proportion to its own diameter.
  const radii = present.map((category) => clusterRadius(groups.get(category)!.length));
  const circumference = radii.reduce((sum, radius) => sum + radius * 2 + GAP, 0);
  // Never closer than a cluster's own radius plus clearance, so the gateway
  // is never swallowed by a large cluster.
  const ringRadius = Math.max(5, circumference / (Math.PI * 2), Math.max(0, ...radii) + 2.5);

  const clusters: TopologyCluster[] = [];
  const nodes: TopologyNode[] = [];
  const gateway: TopologyNode | null = gatewayHost
    ? { host: gatewayHost, category: "firewall/network", x: 0, y: 1.1, z: 0, size: 0.6, gateway: true }
    : null;
  if (gateway) nodes.push(gateway);

  // Start the first cluster straight "up" the screen (negative z, away from
  // the default camera) and walk clockwise.
  let cursor = -Math.PI / 2;
  const totalArc = Math.PI * 2;
  const usedArc = present.reduce((sum, _, index) => sum + (radii[index] * 2 + GAP) / ringRadius, 0);
  const slack = present.length > 0 ? (totalArc - usedArc) / present.length : 0;
  present.forEach((category, index) => {
    const radius = radii[index];
    const span = (radius * 2 + GAP) / ringRadius + slack;
    const angle = cursor + span / 2;
    cursor += span;
    const cx = Math.cos(angle) * ringRadius;
    const cz = Math.sin(angle) * ringRadius;
    const members = [...groups.get(category)!].sort((a, b) => compareIP(a.ip, b.ip));
    clusters.push({ category, x: cx, z: cz, radius, count: members.length, angle });
    members.forEach((host, position) => {
      // Phyllotaxis spiral: even density, no collisions, stable ordering.
      const r = SPACING * Math.sqrt(position + 0.5);
      const theta = position * GOLDEN + angle;
      nodes.push({
        host,
        category,
        x: cx + Math.cos(theta) * r,
        y: nodeHeight(host),
        z: cz + Math.sin(theta) * r,
        size: nodeSize(host),
        gateway: false,
      });
    });
  });

  const extent = ringRadius + Math.max(0, ...radii);
  return { nodes, clusters, gateway, ringRadius, extent: Math.max(extent, 4) };
}

// navigationOrder is the order arrow keys walk through: gateway, then each
// cluster clockwise, then by address inside a cluster — the same order the
// nodes array is built in.
export function neighborIndex(layout: TopologyLayout, currentIP: string, key: "next" | "previous" | "nextCluster" | "previousCluster") {
  const { nodes } = layout;
  if (nodes.length === 0) return -1;
  const index = nodes.findIndex((node) => node.host.ip === currentIP);
  if (index === -1) return 0;
  if (key === "next") return (index + 1) % nodes.length;
  if (key === "previous") return (index - 1 + nodes.length) % nodes.length;
  const category = nodes[index].gateway ? null : nodes[index].category;
  const order = layout.clusters.map((cluster) => cluster.category);
  const position = category ? order.indexOf(category) : -1;
  const target = key === "nextCluster" ? order[(position + 1) % order.length] : order[(position - 1 + order.length) % order.length];
  return nodes.findIndex((node) => !node.gateway && node.category === target);
}
