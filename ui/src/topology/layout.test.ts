import { describe, expect, it } from "vitest";
import type { HostObservation } from "../net";
import { computeLayout, neighborIndex, pickGateway } from "./layout";

const TYPES = ["network_device", "windows_or_smb", "linux_or_iot", "apple_device", "printer", "camera_or_rtsp", "web_device", "unknown"];

function syntheticNetwork(count: number): HostObservation[] {
  return Array.from({ length: count }, (_, index) => {
    const third = Math.floor((index + 1) / 256);
    const fourth = (index + 1) % 256;
    const type = TYPES[index % TYPES.length];
    return {
      ip: `10.20.${third}.${fourth}`,
      alive: index % 5 !== 0,
      open_ports: index % 3 === 0 ? [] : [{ port: 22 + (index % 7), service: "tcp" }],
      device_type: type,
      first_seen: "",
      last_updated: "",
    };
  });
}

describe("topology layout", () => {
  it("puts the gateway at the center", () => {
    const hosts = syntheticNetwork(40);
    const layout = computeLayout(hosts);
    expect(layout.gateway?.host.ip).toBe(pickGateway(hosts)?.ip);
    expect(layout.gateway?.x).toBe(0);
    expect(layout.gateway?.z).toBe(0);
    expect(layout.nodes).toHaveLength(40);
  });

  it("orders clusters by the validated color ring", () => {
    const layout = computeLayout(syntheticNetwork(64));
    const order = layout.clusters.map((cluster) => cluster.category);
    expect(order).toEqual([...order].sort((a, b) => TYPES_ORDER.indexOf(a) - TYPES_ORDER.indexOf(b)));
  });

  it("never overlaps two devices", () => {
    const layout = computeLayout(syntheticNetwork(254));
    for (let i = 0; i < layout.nodes.length; i += 1) {
      for (let j = i + 1; j < layout.nodes.length; j += 1) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        const gap = Math.hypot(a.x - b.x, a.z - b.z);
        expect(gap).toBeGreaterThan(a.size + b.size - 0.05);
      }
    }
  });

  it("is deterministic", () => {
    const hosts = syntheticNetwork(120);
    expect(computeLayout(hosts)).toEqual(computeLayout([...hosts].reverse()));
  });

  it("walks devices and device types with arrow keys", () => {
    const layout = computeLayout(syntheticNetwork(30));
    const first = layout.nodes[0].host.ip;
    expect(neighborIndex(layout, first, "next")).toBe(1);
    expect(neighborIndex(layout, first, "previous")).toBe(layout.nodes.length - 1);
    const jump = neighborIndex(layout, layout.nodes[1].host.ip, "nextCluster");
    expect(layout.nodes[jump].category).not.toBe(layout.nodes[1].category);
  });

  it("lays out a /22 well inside a frame", () => {
    const hosts = syntheticNetwork(1022);
    const timings: number[] = [];
    for (let run = 0; run < 7; run += 1) {
      const start = performance.now();
      computeLayout(hosts);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    expect(timings[3]).toBeLessThan(16);
  });
});

const TYPES_ORDER = ["firewall/network", "windows/smb", "linux/iot", "apple", "printer", "camera/media", "web appliance", "unknown"];
