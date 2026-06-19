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

## v0.1.0: Headless Probe and MaterialTicket Reporting

Goal: ship `netviz-probe` as an always-on LAN probe that a tech can drop on a
box at a customer site, where it scans on an interval and feeds live device
inventory to a MaterialTicket backend.

Status: released June 19, 2026. Core probe and MaterialTicket reporting, native
service management, transport/retry tests, deployment docs, cross-platform
builds, and the live MaterialTicket contract test are complete.

Done:

- `netviz-probe` binary with no desktop, Wails, or UI dependencies.
- Scans a configured CIDR using the shared scanner core and host observation
  model.
- MaterialTicket integration: `internal/materialticket` serializes scan results
  to the MaterialTicket probe device contract (v1) and pushes them to
  `POST /probe/devices` after each completed scan. Upsert-keyed (id falls back
  mac → ip) so re-scans update devices instead of duplicating them.
- Periodic `POST /probe/heartbeat` liveness reporting that carries the probe
  version and scanned CIDR.
- Flag and environment configuration for the MaterialTicket URL and probe API
  key (`-url`/`-key`, `NETVIZ_MATERIALTICKET_URL`/`NETVIZ_MATERIALTICKET_KEY`).
- Continuous (interval) and `-once` run modes with graceful SIGINT/SIGTERM
  shutdown.
- In-memory retry with bounded backoff so a failed push is held for the next
  cycle rather than dropped.
- Native `netviz-probe` binaries for Windows, Linux, and macOS produced by the
  release workflow and bundled in each release archive.
- Wire shape verified against a local stub matching the v1 contract.
- Service installation across platforms via a single integration
  (`kardianos/service`): `install`/`uninstall`/`start`/`stop` subcommands that
  register the probe as a Windows service, a Linux systemd unit, or a macOS
  launchd job.
- Unit tests for the MaterialTicket transport client (`client.go`): header,
  non-2xx handling, and retry behavior.
- Probe deployment doc (service install, env/flag config, host-network note).
- Live meet-in-the-middle test against a running MaterialTicket: confirm
  `created > 0`, then `updated > 0` on re-scan with no duplicates.

Non-goals:

- Probe Docker image (decided against; host-network requirement makes it more
  footgun than convenience for the on-prem case).
- Standalone stdout JSON output (the MaterialTicket push is the reporting path;
  not a v0.1.0 requirement).
- Multi-CIDR / multi-VLAN scanning (single `-cidr` for now).
- Persisting unsent records across probe restarts (next full scan re-pushes
  state).
- Live per-device status streaming.
- Remote command execution, credential handling, or a persistent control
  channel.

Acceptance criteria:

- Probe runs without desktop dependencies. (done)
- Probe uses the same event/observation model as the desktop and CLI. (done)
- MaterialTicket push and heartbeat match the v1 contract and are documented.
  (done)
- Probe installs and runs as a Windows service, systemd unit, and launchd job.
  (implemented; systemd lifecycle passed, Windows registration reaches the
  native service manager and requires elevation as expected)
- Transport client has unit coverage. (done)
- Live MaterialTicket test passes: devices created on first scan, updated on
  re-scan, no duplicates. (done: 1 created, then 1 updated, 1 total device)

## v0.1.x: Desktop Probe Management (fast-follow)

Goal: make the desktop GUI the control surface for the headless probe service —
deploy it and edit its config — without the GUI ever running the report loop
itself. The service stays the durable runner; the GUI is a front-end.

Features:

- Deploy from the GUI: install, start, stop, and uninstall the `netviz-probe`
  service (the same `kardianos/service` path as the CLI subcommands). Install
  requires elevation (UAC / root), which the GUI prompts for or documents.
- Edit probe config from the GUI: MaterialTicket URL, probe key, CIDR, and
  interval.
- Shared config file in a system-wide, service-readable location (e.g.
  `ProgramData` on Windows, `/etc/netviz` on Linux) so the logged-in GUI user
  and the SYSTEM/root service account both reach the same file.
- Probe service reloads its config (re-reads on each cycle, or on change) so GUI
  edits take effect without a manual service restart.
- Service status in the GUI: installed/running state, last successful push, and
  online indication.

Non-goals:

- GUI running the report/push loop in-process (rejected: a GUI needs a
  logged-in session; the headless service is the durable path).
- Multi-tenancy or probe enrollment.

Acceptance criteria:

- A tech can install, configure, and manage the probe service entirely from the
  GUI.
- Config edited in the GUI is picked up by the running service without a manual
  restart.

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
