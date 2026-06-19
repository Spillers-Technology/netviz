# MILESTONES

## v0.0.1: Desktop Scanner and Visualization Release

Goal: release the first useful standalone desktop scanner with live visual
network awareness.

Status: current release target.

Features:

- Wails desktop app.
- CIDR input with validation.
- Start, cancel, and monitor scan controls.
- Native Go TCP-connect scan of constrained LAN-oriented default ports.
- Best-effort hostname resolution.
- Best-effort MAC/vendor enrichment from the local ARP cache.
- Live typed scan events.
- Table view with IP, hostname, MAC, vendor, alive status, open ports, guessed
  device type, first seen, and last updated.
- Grouped graph view with clickable device details.
- Hierarchy visualization with firewall/root node, compact device circles,
  click-to-inspect details, and checked-only filtering.
- Monitor mode that marks devices as new, online, offline, changed, or stable.
- Checked-only dead addresses hidden by default across the main views.
- File menu save/open for scan data and CSV save.
- SQLite local history and latest-run diff.
- CLI JSON event output.
- CLI saved history and latest diff commands.
- Placeholder server endpoints and Docker build path.
- Self-hosted GitHub Actions release artifact workflow.

Non-goals:

- Raw packet scanning.
- SYN scans.
- Vulnerability scanning.
- Remote shell.
- Remote command execution.
- Credential handling.
- RMM-like workflows.
- Server ingest.
- Multi-tenancy.
- Probe enrollment.

Acceptance criteria:

- `go test ./...` passes.
- `go vet ./...` passes.
- Desktop frontend builds.
- Wails desktop app builds locally.
- CLI emits JSON scan events for a CIDR.
- Desktop can start, cancel, and monitor scans.
- Visualizations update from live scan events.
- Hierarchy view remains usable for a `/24` scan.
- Current results save to scan data and CSV files.
- Scan runs persist locally and latest diff works.
- Release workflow can attach platform artifacts when self-hosted runners exist.

## v0.0.2: Visual Polish and Release Hardening

Goal: make the v0.0.1 experience feel intentional, stable, and shippable for
early FOSS users.

Features:

- Better hierarchy layout density for hundreds of devices.
- Better visual states for new, online, offline, and changed devices.
- Device detail panel refinements.
- Port/service filtering and grouping in visual views.
- Clearer loading, empty, cancelled, and monitor states.
- First-run guidance without turning the app into a landing page.
- macOS packaging polish and release notes.
- Screenshot assets for README and GitHub Pages.

Non-goals:

- Probe/server ingest.
- Multi-tenancy.
- Vulnerability scanning.

Acceptance criteria:

- A `/24` scan remains responsive in table, graph, and hierarchy views.
- Users can quickly hide checked-only/offline noise.
- Release artifacts are attached to GitHub Releases from self-hosted runners.
- README and `/docs` reflect the actual release.

## v0.0.3: History, Diff, and Scan Management

Goal: make local history genuinely useful rather than just persisted data.

Features:

- Scan history management UI.
- Clear previous-scan comparison view.
- New devices, missing devices, changed ports, hostname changes, MAC/vendor
  changes, and device type changes.
- Optional history reset.
- Export previous scan/diff.

Non-goals:

- Hosted server history.
- Probe enrollment.
- Multi-tenant data model.

Acceptance criteria:

- Users can browse prior runs.
- Users can compare selected runs, not only latest two.
- Diff results are visible in table and visual views.
- History can be reset intentionally.

## v0.1.0: Headless Probe

Goal: provide a small headless scanner binary that can run unattended on a LAN
and report what it finds.

Status: in progress. `netviz-probe` is implemented with MaterialTicket device
push and heartbeat reporting. Standalone stdout JSON output is still pending.

Features:

- `netviz-probe` binary with no desktop, Wails, or UI dependencies.
- Scans a configured CIDR using the shared scanner core and host observation
  model.
- MaterialTicket integration: `internal/materialticket` serializes scan results
  to the MaterialTicket probe device contract (v1) and pushes them to
  `POST /probe/devices` after each completed scan. Upsert-keyed so re-scans
  update devices instead of duplicating them.
- Periodic `POST /probe/heartbeat` liveness reporting that carries the probe
  version and scanned CIDR.
- Flag and environment configuration for the MaterialTicket URL and probe API
  key (`-url`/`-key`, `NETVIZ_MATERIALTICKET_URL`/`NETVIZ_MATERIALTICKET_KEY`).
- Continuous (interval) and `-once` run modes with graceful SIGINT/SIGTERM
  shutdown.
- In-memory retry with bounded backoff so a failed push is held for the next
  cycle rather than dropped.

Non-goals:

- Remote command execution.
- Credential handling.
- Persistent agent control channel.
- Live per-device status streaming (deferred).

Acceptance criteria:

- Probe runs without desktop dependencies. (done)
- Probe uses the same event/observation model as the desktop and CLI. (done)
- MaterialTicket push and heartbeat match the v1 contract and are documented.
  (done)
- Standalone stdout JSON output mode is available. (pending)

## v0.1.5: Server Ingest and Docker Web UI

Goal: add single-tenant server ingest and a useful containerized web UI.

Features:

- Go HTTP server mode.
- Docker image published to `ghcr.io/spillers-technology/netviz`.
- Server receives scan observations from probes.
- Server stores scan runs and host observations.
- Server renders latest state in a React web UI.

Non-goals:

- Multi-tenancy.
- Probe enrollment.
- Per-tenant tokens.

Acceptance criteria:

- `docker run -p 8080:8080 ghcr.io/spillers-technology/netviz` serves the app.
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
- More robust vendor enrichment strategy.

Non-goals:

- Expanding beyond authorized network visibility.
- Vulnerability scanning.

Acceptance criteria:

- Release artifacts are reproducible.
- Common install paths are documented.
- UI remains responsive during expected scans.
