# NetViz

NetViz is a modern LAN scanner and network visualization project. The first
release focuses on a small, useful desktop scanner: enter a CIDR, start a
bounded TCP-connect scan, and watch host observations stream into a table.

NetViz is not an Nmap wrapper, vulnerability scanner, remote shell, credential
tool, or RMM platform. It intentionally avoids raw packet scanning, SYN scans,
remote command execution, and credential handling.

> Safety note: only scan networks you own or are explicitly authorized to scan.

## Screenshot

Screenshot placeholder: the v0.0.1 UI is a table-first Wails desktop shell.

## Current Status

Early project scaffold with working foundations through v0.0.3:

- Reusable Go scanner core with JSON scan events.
- Minimal CLI that scans a CIDR and prints JSON events.
- Wails desktop shell with table, graph, history, and latest-diff views.
- SQLite local history for completed desktop scans.
- Placeholder Go server and Dockerfile for future probe/server mode.
- GitHub Actions for Go, frontend, Docker, and desktop build paths.

## Quick Start: Desktop

Prerequisites:

- Go 1.25 or newer
- Node.js and npm
- Wails v2 CLI

```sh
go test ./...
cd desktop
npm install --prefix frontend
wails dev
```

The desktop app validates CIDR input and exposes only the fixed scanner
configuration needed for the v0.0.1 LAN scan workflow.

Packaged desktop build:

```sh
make build-desktop
```

## Quick Start: CLI

```sh
go run ./cmd/netviz-cli -cidr 192.168.1.0/24
```

Each scan event is printed as one JSON object per line.

## Quick Start: Server Docker Image

The Docker image runs the server mode, not the Wails desktop app.

```sh
docker run -p 8080:8080 ghcr.io/spilloid/netviz
```

For local development:

```sh
make docker-build
make docker-run
```

Server v0.0.1 currently provides `/healthz`, `/api/version`, `/api/scans`, and a
placeholder web UI at `/`.

## Development Setup

```sh
make test
make lint
make build-cli
make build-server
make build-probe
```

Desktop:

```sh
npm install --prefix desktop/frontend
npm run --prefix desktop/frontend build
make build-desktop
```

Frontend placeholder builds:

```sh
npm install --prefix web
npm run --prefix web build
npm install --prefix desktop/frontend
npm run --prefix desktop/frontend build
```

## Architecture

The project is built around one rule:

```text
ScanEngine -> EventBus -> Consumers
```

Consumers can be the desktop table UI, future graph UI, JSON exporter, CSV
exporter, SQLite writer, HTTP reporter, server ingest endpoint, or future
websocket streamer. The scanner core must stay reusable outside Wails.

## Roadmap Summary

- v0.0.1: standalone desktop scanner with live table and export
- v0.0.2: graph/tree visualization
- v0.0.3: local scan history and diffs
- v0.1.0: headless probe
- v0.1.5: server ingest and Docker image
- v0.1.9: smarter hosted/server mode
- v0.2.0: polish and hardening

See [MILESTONES.md](MILESTONES.md) for acceptance criteria.

## License

MIT. See [LICENSE](LICENSE).
