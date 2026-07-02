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
- The AnchorDesk integration lives in `internal/anchordesk` and depends
  only on `internal/model`. The probe may depend on the scanner core and
  `internal/anchordesk`.
- The server may depend on `internal/anchordesk` (it accepts the same v1
  probe wire contract) and `internal/storage`, never on Wails or desktop
  code. The server web UI source lives in `web/` and builds into
  `internal/server/webdist` (committed; rebuilt with `make build-web`).
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
- v0.1.0: `netviz-probe` always-on LAN probe that pushes device inventory to a
  AnchorDesk backend with heartbeat reporting, installable as a Windows
  service, systemd unit, or launchd job. Released June 19, 2026.
- v0.2.0: desktop probe management — GUI installs/manages the headless probe
  service and edits its shared config file; the service, not the GUI, runs the
  report loop. Released July 2, 2026.
- v0.3.0: server ingest mode and Docker image at `ghcr.io/spillers-technology/netviz`
  (single-tenant; multi-tenancy is dropped from the roadmap — AnchorDesk owns
  tenancy, each probe reports to its own company).
- v0.4.0: polish, hardening, performance, packaging/signing, updater
  completion, vendor enrichment, per-device history, and docs.
- v0.9.0: server sign-in with SSO — OIDC first-class, SAML2 demand-driven;
  probe endpoints keep key auth. Required before 1.0.0.
- v1.0.0: stability freeze — frozen probe contract v1, versioned file/config/
  schema formats with migration, semver policy, and a security posture doc.

## What Not To Build Yet

- No raw packet scanning.
- No SYN scans.
- No vulnerability scanning.
- No remote shell.
- No remote command execution.
- No credential handling.
- No RMM-like workflows.
- No server ingest before the server milestone.
- No multi-tenancy at all — AnchorDesk owns tenancy; NetViz stays single-site.

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
