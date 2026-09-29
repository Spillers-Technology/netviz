import type { HostObservation, ScanRun } from "@netviz/ui";

export type { PortObservation, ScanRun } from "@netviz/ui";

// A device as the server reports it: the latest observation pushed by a probe.
export type Device = HostObservation;

export type ProbeStatus = {
  last_seen: string;
  version?: string;
  cidr?: string;
  status?: string;
};

export type ServerState = {
  version: string;
  probe?: ProbeStatus;
  run?: ScanRun;
  devices: Device[];
};

export type Identity = { auth: boolean; email?: string; name?: string };
