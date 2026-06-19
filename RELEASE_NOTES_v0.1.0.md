# NetViz v0.1.0

NetViz v0.1.0 turns the scanner core into an unattended LAN probe for
MaterialTicket. A technician can place one native binary on a customer network,
register it with the host operating system, and continuously feed device
inventory and liveness into MaterialTicket.

## Highlights

- New `netviz-probe` headless binary with no desktop or Wails dependency.
- Continuous CIDR scanning and `-once` smoke-test mode.
- MaterialTicket device ingest through `POST /probe/devices`.
- Probe heartbeat reporting through `POST /probe/heartbeat`.
- Stable device upserts keyed by MAC address with IP fallback.
- Silent, never-discovered CIDR addresses are not manufactured as devices;
  previously observed devices can still transition to down.
- Held-batch retry with bounded backoff when the backend is unavailable.
- Native service management on Windows, Linux/systemd, and macOS/launchd.
- Environment-based URL and API-key configuration.
- Cross-platform deployment, logging, upgrade, and troubleshooting guide.

## Service commands

The probe binary manages its own native service registration:

```text
netviz-probe install -cidr 192.168.1.0/24 -interval 1m
netviz-probe start
netviz-probe status
netviz-probe stop
netviz-probe uninstall
```

Set `NETVIZ_MATERIALTICKET_URL` and `NETVIZ_MATERIALTICKET_KEY` before
installation so the key is not placed in the registered command line. Service
installation and removal require Administrator/root privileges.

See the
[probe deployment guide](https://github.com/Spillers-Technology/netviz/blob/v0.1.0/PROBE_DEPLOYMENT.md)
for platform-specific commands.

## Contract validation

The v1 wire contract was tested against a running MaterialTicket backend:

- first scan: 1 device created
- second scan: 1 device updated
- final inventory: 1 device, with no duplicate

Transport tests also cover the probe key header, device and heartbeat payloads,
non-2xx responses, held-record merging, and backoff reset after recovery.

## Known limits

- One IPv4 CIDR per probe.
- Retry and known-device state are in memory; after a restart, the probe
  rebuilds its local view from newly discovered devices.
- Routed scans cannot collect ARP/MAC/vendor data across VLAN boundaries.
- Service configuration changes require uninstalling and reinstalling the
  service in v0.1.0.
- Standalone JSON output and desktop-based probe management are planned
  follow-ups, not v0.1.0 features.

## Security

Only scan networks you own or are explicitly authorized to assess. Probe API
keys are credentials: protect the host and rotate a key when a probe machine is
retired or compromised.
