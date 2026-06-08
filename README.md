# NetViz
<img width="1448" height="1086" alt="image" src="https://github.com/user-attachments/assets/1ee86036-d72d-4979-b68d-cf8503af0db4" />

NetViz is a modern FOSS LAN scanner and network visualization tool. It is built
around a native Go TCP-connect scanner, a typed event stream, and a Wails desktop
app that turns scan results into tables, maps, hierarchy nodes, history, and
exports.

NetViz is not an Nmap wrapper, vulnerability scanner, remote shell, credential
tool, or RMM platform. It intentionally avoids raw packet scanning, SYN scans,
remote command execution, and credential handling.

> Safety note: only scan networks you own or are explicitly authorized to scan.

## Current Release: v0.0.1

v0.0.1 is the first desktop release candidate. The scope is broader than the
original table-only plan because the visual layer became central to the product.

Included:

- Wails desktop app for macOS local testing.
- CIDR validation and bounded native Go TCP-connect scanning.
- Live event stream from scanner core to UI and CLI.
- Start, cancel, and monitor scan controls.
- Monitor mode that rescans periodically and marks devices as new, online,
  offline, changed, or stable.
- Table view with IP, hostname, MAC, vendor, alive status, open ports, device
  type, and timestamps.
- Graph view grouped by inferred device category.
- Hierarchy view with a firewall/root node, compact device circles, click-to-
  inspect details, and checked-only filtering.
- Checked-only dead addresses hidden by default across the main views.
- File menu actions for opening saved scan data, saving scan data, and saving
  CSV.
- SQLite local history with latest-run diff support.
- CLI parity for scan JSON events, saved scan history, and latest diff.
- Placeholder server and Docker image path for future probe/server mode.
- Self-hosted GitHub Actions for CI, Docker, desktop, and release assets.
- Static `/docs` landing page for GitHub Pages.

Still rough in v0.0.1:

- The visualizations are useful but still early.
- Device type classification is intentionally simple.
- MAC/vendor enrichment is best-effort from the local ARP cache.
- Server/probe ingest is placeholder only.
- Packaging is functional but not yet polished for end users.

## Quick Start: Desktop

Prerequisites:

- Go 1.25 or newer
- Node.js and npm
- Wails v2 CLI

```sh
go test ./...
npm ci --prefix desktop/frontend
cd desktop
wails dev
```

Packaged desktop build:

```sh
make build-desktop
open desktop/build/bin/netviz.app
```

## Quick Start: CLI

Print JSON scan events:

```sh
go run ./cmd/netviz-cli scan -cidr 192.168.1.0/24
```

Save a scan to local SQLite history:

```sh
./bin/netviz-cli scan -cidr 192.168.1.0/24 -save
./bin/netviz-cli history
./bin/netviz-cli diff
```

The CLI uses the same scanner core and history model as the desktop app.

## Quick Start: Server Docker Image

The Docker image runs server mode, not the Wails desktop app. Server ingest is
planned for a later release; v0.0.1 exposes placeholders.

```sh
docker run -p 8080:8080 ghcr.io/spilloid/netviz
```

Server v0.0.1 currently provides:

- `/healthz`
- `/api/version`
- `/api/scans`
- `/`

## Development Setup

```sh
make test
make lint
make build-cli
make build-server
make build-probe
make build-desktop
```

Frontend builds:

```sh
npm ci --prefix web
npm run --prefix web build
npm ci --prefix desktop/frontend
npm run --prefix desktop/frontend build
```

## Releases

GitHub Actions are configured for self-hosted runners only. Publishing a GitHub
Release triggers Linux, Windows, and macOS release builds when matching
self-hosted runners are available, then attaches platform archives and SHA-256
checksums to the release.

See [RELEASING.md](RELEASING.md).

## Architecture

The project is built around one rule:

```text
ScanEngine -> EventBus -> Consumers
```

Current consumers:

- desktop table view
- desktop grouped graph view
- desktop hierarchy visualization
- JSON event CLI
- File-backed scan save/open and CSV save
- SQLite history and diff storage

Future consumers:

- headless probe reporter
- server ingest endpoint
- web UI latest-state view
- websocket event streamer

The scanner core must stay reusable outside Wails.

## Roadmap Summary

- v0.0.1: desktop scanner, live monitoring, visualizations, history, CLI parity
- v0.0.2: visual polish, interaction quality, packaging, release hardening
- v0.0.3: history/diff UX improvements and scan management
- v0.1.0: headless probe
- v0.1.5: single-tenant server ingest and Docker-hosted web UI
- v0.1.9: multi-tenant hosted/server mode
- v0.2.0: polish, performance, accessibility, and docs

See [MILESTONES.md](MILESTONES.md) for acceptance criteria.

See [CHANGELOG.md](CHANGELOG.md) for release notes.

Product release notes for v0.0.1 are in
[RELEASE_NOTES_v0.0.1.md](RELEASE_NOTES_v0.0.1.md).

## License

MIT. See [LICENSE](LICENSE).
