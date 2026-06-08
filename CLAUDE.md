# CLAUDE.md

## Project Mission

NetViz is a FOSS LAN scanner and network visualization tool. It should feel like
a modern alternative to Advanced IP Scanner or Angry IP Scanner while keeping a
clean Go-native scanner foundation and an event-driven desktop, probe, and
server path.

This is not an Nmap wrapper.

## Current Release Scope

v0.0.1 is the first desktop release target. The original table-only scope is no
longer accurate. v0.0.1 now includes:

- Wails desktop app.
- CIDR validation.
- Native Go TCP-connect scan of constrained LAN-oriented default ports.
- Best-effort hostname resolution.
- Best-effort MAC/vendor enrichment from the local ARP cache.
- Live scanner events.
- Table view.
- Grouped graph view.
- Hierarchy visualization with firewall/root node and clickable device circles.
- Monitor mode that marks devices as new, online, offline, changed, or stable.
- Checked-only dead addresses hidden by default across the main views.
- File menu save/open for scan data and CSV save.
- SQLite local history and latest-run diff.
- CLI scan/history/diff parity.
- Placeholder server and Docker build path.
- Self-hosted GitHub Actions release builds.

## Architecture Rules

- The core architecture is `ScanEngine -> EventBus -> Consumers`.
- `internal/scanner` must not depend on Wails, React, HTTP server code, storage,
  Docker, or UI packages.
- Desktop may depend on scanner core.
- Server must not depend on Wails.
- Probe must not depend on Wails or desktop code.
- Scanner events are the primary integration surface.
- Keep scanner configuration constrained and explicit. Validate CIDR input. Do
  not add arbitrary scanner flags.
- Visualizations should consume the same event/host model as table, export, and
  history.

## Version Goals

- v0.0.1: desktop scanner, live monitoring, visualizations, exports, local
  history, and CLI parity.
- v0.0.2: visual polish, packaging, release hardening, screenshots, and UX
  cleanup.
- v0.0.3: history/diff UX and scan management.
- v0.1.0: `netviz-probe` headless scanner that emits JSON and can optionally
  report to a server.
- v0.1.5: server ingest mode and Docker image at `ghcr.io/spillers-technology/netviz`.
- v0.1.9: hosted/server model with multi-tenancy, probe enrollment, and tokens.
- v0.2.0: polish, hardening, performance, accessibility, and docs.

## What Not To Build Yet

- No raw packet scanning.
- No SYN scans.
- No vulnerability scanning.
- No remote shell.
- No remote command execution.
- No credential handling.
- No RMM-like workflows.
- No server ingest before the server milestone.
- No multi-tenancy before the hosted/server milestone.

## Commands

```sh
make test
make lint
make build-cli
make build-server
make build-probe
make build-desktop
make docker-build
make docker-run
```

Equivalent direct commands:

```sh
go test ./...
go vet ./...
go build ./cmd/netviz-cli
go build ./cmd/netviz-server
go build ./cmd/netviz-probe
cd desktop && wails build
```

Use Go 1.25 or newer. The SQLite history store uses the pure-Go
`modernc.org/sqlite` driver to keep Docker and CI away from CGO requirements.

## Coding Conventions

- Prefer small, explicit Go packages.
- Keep scanner APIs context-aware.
- Keep concurrency bounded.
- Treat scan cancellation as a normal path.
- Prefer typed events over UI-specific callbacks.
- Add tests for CIDR expansion, classification, enrichment parsing, storage, and
  scanner behavior.
- Keep frontend controls dense and operational, not marketing-style.
- For visualization changes, preserve responsiveness for `/24` scans.

## Safety and Security Boundaries

NetViz should only scan networks the user owns or is authorized to scan. Keep the
scanner intentionally limited to CIDR/range discovery, TCP-connect scanning of
known ports, hostname resolution, ARP-cache enrichment, event streaming, export,
local history, and visualization.

Do not accidentally build an RMM.
