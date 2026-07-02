export type PortObservation = {
  port: number;
  service: string;
};

export type Device = {
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
