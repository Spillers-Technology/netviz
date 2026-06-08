# MILESTONES

## v0.0.1: Desktop Scanner/Table Release

Goal: ship the first useful standalone desktop LAN scanner.

Features:

- Wails desktop app.
- CIDR input with validation.
- Start and cancel scan.
- Native Go TCP-connect scan of common ports.
- Live scan events.
- Table columns for IP, hostname, alive, open ports, device type, first seen,
  and last updated.
- JSON and CSV export of current results.

Non-goals:

- Graph view.
- SQLite history.
- Probe/server ingest.
- Auth or multi-tenancy.
- Raw packet, SYN, vuln, credential, or remote execution features.

Acceptance criteria:

- `go test ./...` passes.
- CLI emits JSON scan events for a CIDR.
- Desktop shell can start and cancel a scan.
- Results update live in a table.
- Current results export to JSON and CSV.

## v0.0.2: Visualization Release

Goal: add the differentiating graph/tree view after the scanner/table workflow is
clean.

Features:

- Graph/tree tab.
- Nodes appear as devices are discovered.
- Port badges attach to nodes.
- Device categories: router/network, windows/smb, linux/ssh, printer, web
  appliance, and unknown.
- Hide inactive/dead IPs by default.

Non-goals:

- Historical diffing.
- Server ingest.
- Multi-tenancy.

Acceptance criteria:

- Table and graph are both driven by the same scan event stream.
- Graph remains responsive during a `/24` LAN scan.
- Users can switch between table and graph without losing scan state.

## v0.0.3: Scan History/Diff Release

Goal: add local history and comparison.

Features:

- SQLite local history.
- Persist scan runs and host observations.
- Compare current scan to previous scan.
- Show new devices, missing devices, changed ports, and hostname changes.

Non-goals:

- Hosted server history.
- Probe enrollment.
- Multi-tenant data model.

Acceptance criteria:

- Scan runs persist locally.
- Diff view clearly separates new, missing, and changed hosts.
- History can be disabled or reset.

Initial scaffold status: SQLite scan-run persistence and latest-run diffing are
implemented. A reset/management UI is still future polish.

## v0.1.0: Headless Probe

Goal: provide a small headless scanner binary.

Features:

- `netviz-probe`.
- Scans configured CIDR(s).
- Outputs JSON.
- Optional POST to a server URL.

Non-goals:

- Remote command execution.
- Credential handling.
- Persistent agent control channel.

Acceptance criteria:

- Probe runs without desktop dependencies.
- Probe output uses the same event/observation model.
- POST reporting is optional and documented.

## v0.1.5: Server Ingest/Docker Release

Goal: add single-tenant server ingest and a container image.

Features:

- Go HTTP server mode.
- Docker image published to `ghcr.io/spilloid/netviz`.
- Server receives scan observations from probes.
- Server stores scan runs and host observations.
- Server renders latest state in a web UI.

Non-goals:

- Multi-tenancy.
- Probe enrollment.
- Per-tenant tokens.

Acceptance criteria:

- `docker run -p 8080:8080 ghcr.io/spilloid/netviz` serves the app.
- Server accepts probe observations.
- Latest network state renders in the web UI.

## v0.1.9: Multi-Tenant Hosted/Server Mode

Goal: prepare server mode for hosted or shared deployments.

Features:

- Multi-tenancy.
- Probe enrollment.
- Per-tenant tokens.
- Public URL deployment model.
- Probe phone-home architecture.
- Historical diff dashboard.

Non-goals:

- RMM features.
- Remote shell or command execution.
- Credential collection.

Acceptance criteria:

- Tenant isolation is tested.
- Probe authentication is documented.
- Hosted deployment guide exists.

## v0.2.0: Polish and Hardening

Goal: make NetViz reliable and pleasant enough for broader FOSS use.

Features:

- Packaging improvements.
- Better error states.
- Performance tuning for common LAN sizes.
- Accessibility pass.
- Documentation examples.
- Release checklist.

Non-goals:

- Expanding beyond authorized network visibility.
- Vulnerability scanning.

Acceptance criteria:

- Release artifacts are reproducible.
- Common install paths are documented.
- UI remains responsive during expected scans.
