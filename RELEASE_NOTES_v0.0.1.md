> **Historical record — practice retired.** Dedicated per-version
> `RELEASE_NOTES_vX.Y.Z.md` files were written for v0.0.1 through v0.2.0 only.
> Starting with v0.3.0, [CHANGELOG.md](CHANGELOG.md) is the sole release-notes
> location; no further `RELEASE_NOTES_*.md` files will be added. See
> [RELEASING.md](RELEASING.md) for the current release process. This file is
> kept as-is for historical reference.

# NetViz v0.0.1

NetViz v0.0.1 is the first public desktop release of a modern FOSS LAN scanner
and network visualization tool.

This release establishes the core product shape: a native Go scan engine,
live scan events, a Wails desktop app, and visual network views that make local
network scan results easier to understand than a raw port table.

NetViz is intentionally focused. It is not an Nmap wrapper, vulnerability
scanner, credential tool, remote shell, or RMM platform. It is for authorized
LAN discovery and visualization.

## Highlights

- Native Go TCP-connect LAN scanner.
- Live scan event stream from scanner core to UI and CLI.
- Desktop app with table, graph, and hierarchy views.
- Monitor mode that notices devices going online, offline, or changing.
- Clickable device details with IP, hostname, MAC, vendor, type, and open ports.
- File menu support for opening and saving scan data.
- CSV save for sharing or analysis.
- Local SQLite history and latest-run diff.
- CLI scan/history/diff parity.
- Self-hosted GitHub Actions release build workflow.

## Desktop Scanner

The desktop app can scan an IPv4 CIDR such as `192.168.1.0/24`, stream results
as hosts are checked, and update the UI as observations arrive.

Core controls:

- Start Scan
- Cancel
- Monitor
- File -> Open Scan
- File -> Save Scan
- File -> Save CSV

Monitor mode repeats scans on a lightweight interval and keeps prior devices in
view long enough to show useful state transitions:

- new
- online
- offline
- changed
- stable

## Visualizations

v0.0.1 includes three ways to inspect the same scan data.

### Table

The table remains the precise operational view. It shows:

- IP
- hostname
- MAC address
- vendor
- alive status
- open ports
- guessed device type
- first seen
- last updated

Checked-only dead addresses are hidden by default to reduce noise. They can be
shown with the `Show checked-only` toggle.

### Graph

The graph groups devices by inferred category and exposes open port badges
directly on each node. Clicking a device opens a detail panel.

### Hierarchy

The hierarchy view is designed for larger LAN scans. It places a firewall/root
node at the center and draws devices as compact clickable circles around it.
Open port counts are shown as badges, while the details panel keeps the dense
view readable.

## Scan Data and History

NetViz can save and reopen scan data from the desktop File menu. Saved scan data
uses a NetViz JSON format with version metadata.

The app also stores completed scans locally in SQLite and can compare the latest
two runs.

The CLI shares the same model:

```sh
netviz-cli scan -cidr 192.168.1.0/24
netviz-cli scan -cidr 192.168.1.0/24 -save
netviz-cli history
netviz-cli diff
```

## Scanner Scope

The scanner performs bounded TCP-connect checks against a constrained
LAN-oriented default port set. It also performs best-effort hostname resolution
and best-effort MAC/vendor enrichment from the local ARP cache.

Included examples:

- SSH
- HTTP/HTTPS
- SMB
- RDP
- VNC
- printer ports
- RTSP
- MQTT
- Plex
- common alternate web/admin ports

Not included:

- raw packet scanning
- SYN scanning
- vulnerability scanning
- credential handling
- remote command execution
- remote shell
- agent control

## Server and Docker

v0.0.1 includes the beginning of server mode so the project has a clean path
toward probes and centralized ingest.

Current server endpoints:

- `/healthz`
- `/api/version`
- `/api/scans`
- `/`

Server ingest is not implemented in v0.0.1. The Docker image target is for
future server mode, not the desktop app.

## Release Artifacts

GitHub Actions are configured for self-hosted runners only. When matching
self-hosted Linux, Windows, and macOS runners are available, the release
workflow builds platform archives and attaches SHA-256 checksum files.

## Known Limitations

- Visualizations are useful but still early and will receive more polish.
- Device classification is intentionally conservative and simple.
- MAC/vendor enrichment depends on what the local operating system has in its
  ARP cache.
- The app is not yet distributed as polished installers.
- Server/probe ingest is planned, not present.

## Safety

Only scan networks you own or are explicitly authorized to scan.

NetViz v0.0.1 is about local visibility, not exploitation or remote management.

## What Comes Next

The next release focuses on polish and release hardening:

- better visual density for large scans
- clearer graph and hierarchy interactions
- improved device details
- better scan history management
- screenshots and packaging improvements
- more refined release artifacts

