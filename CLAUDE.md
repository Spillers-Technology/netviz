# CLAUDE.md

## Project Mission

NetViz is a FOSS LAN scanner and network visualization tool. It should feel like
a modern alternative to Advanced IP Scanner or Angry IP Scanner while keeping a
clean Go-native scanner foundation and a future event-driven visualization,
probe, and server path.

This is not an Nmap wrapper.

## Architecture Rules

- The core architecture is `ScanEngine -> EventBus -> Consumers`.
- `internal/scanner` must not depend on Wails, React, HTTP server code, storage,
  Docker, or UI packages.
- Desktop may depend on scanner core.
- Server must not depend on Wails.
- Probe must not depend on Wails or desktop code.
- Scanner events are the primary integration surface.
- Keep v0.0.1 table-only. Do not build graph visualization yet.
- Keep scanner configuration constrained and explicit. Validate CIDR input. Do
  not add arbitrary scanner flags.

## Version Goals

- v0.0.1: standalone Wails desktop scanner with live table results, cancel, JSON
  export, and CSV export.
- v0.0.2: graph/tree visualization with nodes appearing during scan.
- v0.0.3: SQLite local history and scan diffs.
- v0.1.0: `netviz-probe` headless scanner that emits JSON and can optionally
  report to a server.
- v0.1.5: server ingest mode and Docker image at `ghcr.io/spilloid/netviz`.
- v0.1.9: hosted/server model with multi-tenancy, probe enrollment, and tokens.
- v0.2.0: polish, hardening, packaging, and docs.

## What Not To Build Yet

- No raw packet scanning.
- No SYN scans.
- No vulnerability scanning.
- No remote shell.
- No remote command execution.
- No credential handling.
- No RMM-like workflows.
- No graph UI in v0.0.1.
- No server ingest or multi-tenancy before the relevant milestones.

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
- Add tests for CIDR expansion, classification, and scanner behavior.
- Keep frontend code simple until the event model is stable.

## Safety and Security Boundaries

NetViz should only scan networks the user owns or is authorized to scan. Keep the
scanner intentionally limited to CIDR/range discovery, TCP-connect scanning of
known ports, hostname resolution, event streaming, export, and visualization.

Do not accidentally build an RMM.
