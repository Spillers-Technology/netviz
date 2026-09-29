import { describe, expect, it } from "vitest";
import {
  categoryFor,
  classifyTransition,
  compareIP,
  deviceSummary,
  formatTime,
  hostMatchesFilter,
  isValidCIDR,
  normalizeHost,
  parsePortList,
  shouldShowHost,
  textCompare,
  type HostObservation,
} from "./net";

function host(overrides: Partial<HostObservation> = {}): HostObservation {
  return {
    ip: "192.168.1.20",
    hostname: "studio-pc",
    mac_address: "3c:7c:3f:0b:9e:41",
    vendor: "ASUSTek",
    alive: true,
    open_ports: [{ port: 445, service: "smb" }],
    device_type: "windows_or_smb",
    first_seen: "2026-09-20T09:12:00Z",
    last_updated: "2026-09-28T20:00:00Z",
    ...overrides,
  };
}

describe("net helpers", () => {
  it("orders IPs numerically, not as text", () => {
    expect(["192.168.1.100", "192.168.1.9", "192.168.1.20"].sort(compareIP)).toEqual(["192.168.1.9", "192.168.1.20", "192.168.1.100"]);
  });

  it("sorts blanks last", () => {
    expect(["", "b", "A"].sort(textCompare)).toEqual(["A", "b", ""]);
  });

  it("validates IPv4 CIDRs", () => {
    expect(isValidCIDR("192.168.1.0/24")).toBe(true);
    expect(isValidCIDR(" 10.0.0.0/8 ")).toBe(true);
    expect(isValidCIDR("192.168.1.0")).toBe(false);
    expect(isValidCIDR("300.1.1.0/24")).toBe(false);
    expect(isValidCIDR("192.168.1.0/33")).toBe(false);
  });

  it("categorizes devices", () => {
    expect(categoryFor(host())).toBe("windows/smb");
    expect(categoryFor(host({ open_ports: [{ port: 53, service: "dns" }], device_type: "linux_or_iot" }))).toBe("firewall/network");
    expect(categoryFor(host({ alive: false, open_ports: [] }))).toBe("unknown");
  });

  it("classifies monitor transitions", () => {
    const before = host();
    expect(classifyTransition(undefined, before)).toBe("new");
    expect(classifyTransition(before, host({ alive: false, open_ports: [], mac_address: "" }))).toBe("offline");
    expect(classifyTransition(host({ alive: false, open_ports: [], mac_address: "" }), before)).toBe("online");
    expect(classifyTransition(before, host({ open_ports: [{ port: 3389, service: "rdp" }] }))).toBe("changed");
    expect(classifyTransition(before, host())).toBe("stable");
  });

  it("hides silent addresses unless asked or noteworthy", () => {
    const silent = host({ alive: false, open_ports: [], mac_address: "", vendor: "", hostname: "" });
    expect(shouldShowHost(silent, "stable", false)).toBe(false);
    expect(shouldShowHost(silent, "stable", true)).toBe(true);
    expect(shouldShowHost(silent, "offline", false)).toBe(true);
  });

  it("matches search across fields, including the readable type", () => {
    expect(hostMatchesFilter(host(), "stable", "asus")).toBe(true);
    expect(hostMatchesFilter(host(), "stable", "445/smb")).toBe(true);
    expect(hostMatchesFilter(host(), "stable", "windows")).toBe(true);
    expect(hostMatchesFilter(host(), "changed", "changed")).toBe(true);
    expect(hostMatchesFilter(host(), "stable", "printer")).toBe(false);
    expect(hostMatchesFilter(host(), "stable", "")).toBe(true);
  });

  it("parses port lists leniently", () => {
    expect(parsePortList("8006, 9443 10000;x 0 70000 8006")).toEqual([8006, 9443, 10000]);
  });

  it("normalizes hosts with null ports", () => {
    const normalized = normalizeHost({ ...host(), open_ports: null as unknown as [], device_type: "" });
    expect(normalized.open_ports).toEqual([]);
    expect(normalized.device_type).toBe("unknown");
  });

  it("keeps the date on older timestamps", () => {
    const now = new Date("2026-09-28T12:00:00");
    expect(formatTime("2026-09-28T09:30:00", now)).not.toMatch(/Sep/);
    expect(formatTime("2026-09-20T09:30:00", now)).toMatch(/Sep/);
    expect(formatTime("not a date", now)).toBe("not a date");
  });

  it("builds a ticket-ready summary", () => {
    const summary = deviceSummary(host(), "changed");
    expect(summary).toContain("studio-pc (192.168.1.20)");
    expect(summary).toContain("Type: Windows");
    expect(summary).toContain("changed in the latest pass");
    expect(summary).toContain("Open ports: 445/smb");
  });
});
