// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useScan } from "./useScan";
import { useUpdates } from "./useUpdates";
import { useProbe } from "./useProbe";
import type { ProbeServiceStatus, UpdateInfo } from "../bridge";

// Regression tests for defects found in the STD-001 adversarial review of the
// redesign, run against a fake Wails bridge.

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const update = (overrides: Partial<UpdateInfo> = {}): UpdateInfo => ({
  current_version: "v1.0.0",
  latest_version: "v1.1.0",
  available: true,
  release_url: "",
  asset_name: "netviz.zip",
  asset_url: "",
  checksum_name: "",
  checksum_url: "",
  download_path: "",
  message: "",
  ...overrides,
});

const status = (overrides: Partial<ProbeServiceStatus> = {}): ProbeServiceStatus => ({
  probe_path: "",
  install_path: "C:/Program Files/NetViz/netviz-probe.exe",
  config_path: "",
  found: true,
  state: "not installed",
  severity: "info",
  summary: "",
  message: "",
  output: "",
  ...overrides,
});

let bridge: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  window.localStorage.clear();
  bridge = {
    StartScan: vi.fn(async () => {}),
    StartMonitorScan: vi.fn(async () => {}),
    CancelScan: vi.fn(async () => {}),
    DefaultPorts: vi.fn(async () => [
      { port: 22, service: "ssh" },
      { port: 80, service: "http" },
    ]),
    DetectNetworks: vi.fn(async () => ["192.168.1.0/24"]),
    SaveScanFile: vi.fn(async () => false),
    SaveCSVFile: vi.fn(async () => true),
    OpenScanFile: vi.fn(async () => null),
    CheckForUpdate: vi.fn(async () => update()),
    DownloadLatestUpdate: vi.fn(async () => update({ download_path: "C:/Downloads/netviz.zip" })),
    GetProbeStatus: vi.fn(async () => status()),
    ProvisionProbe: vi.fn(async () => status({ probe_path: "C:/Program Files/NetViz/netviz-probe.exe", state: "running" })),
    ProbeServiceAction: vi.fn(async () => status()),
    ChooseProbeBinary: vi.fn(async () => "C:/Users/me/Downloads/netviz-probe.exe"),
  };
  window.go = { main: { App: bridge as never } };
  window.runtime = { EventsOn: () => () => {} };
});

afterEach(() => {
  cleanup();
  delete window.go;
  delete window.runtime;
});

describe("useScan", () => {
  it("refuses to scan with every port turned off, from any entry point", async () => {
    const { result } = renderHook(() => useScan());
    await waitFor(() => expect(result.current.cidr).toBe("192.168.1.0/24"));
    await waitFor(() => expect(result.current.portDefs).toHaveLength(2));
    act(() => result.current.setDisabledPorts([22, 80]));
    expect(result.current.blocked).toMatch(/scan ports/);
    await act(() => result.current.startScan(false));
    expect(bridge.StartScan).not.toHaveBeenCalled();
    expect(result.current.error?.lead).toMatch(/scan ports/);
  });

  it("reports a cancelled save as not saved", async () => {
    const { result } = renderHook(() => useScan());
    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.fileAction("save");
    });
    expect(saved).toBe(false);
    await act(async () => {
      saved = await result.current.fileAction("csv");
    });
    expect(saved).toBe(true);
  });
});

describe("useUpdates", () => {
  it("never lets a slow startup check overwrite a finished download", async () => {
    const slow = deferred<UpdateInfo>();
    bridge.CheckForUpdate.mockImplementationOnce(() => slow.promise);
    const { result } = renderHook(() => useUpdates());
    await act(() => result.current.download());
    expect(result.current.info.download_path).toBe("C:/Downloads/netviz.zip");
    await act(async () => slow.resolve(update()));
    expect(result.current.info.download_path).toBe("C:/Downloads/netviz.zip");
  });
});

describe("useProbe", () => {
  it("adopts the installed path after provisioning a probe picked from Downloads", async () => {
    const { result } = renderHook(() => useProbe("192.168.1.0/24"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(() => result.current.locate());
    expect(result.current.probePath).toBe("C:/Users/me/Downloads/netviz-probe.exe");
    await act(async () => {
      await result.current.provision();
    });
    expect(result.current.probePath).toBe("C:/Program Files/NetViz/netviz-probe.exe");
  });
});
