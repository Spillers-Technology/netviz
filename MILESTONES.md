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

## v0.1.0: Headless Probe and AnchorDesk Reporting

Goal: ship `netviz-probe` as an always-on LAN probe that a tech can drop on a
box at a customer site, where it scans on an interval and feeds live device
inventory to an AnchorDesk backend.

Status: released June 19, 2026. Core probe and AnchorDesk reporting, native
service management, transport/retry tests, deployment docs, cross-platform
builds, and the live AnchorDesk contract test are complete.

Done:

- `netviz-probe` binary with no desktop, Wails, or UI dependencies.
- Scans a configured CIDR using the shared scanner core and host observation
  model.
- AnchorDesk integration: `internal/anchordesk` serializes scan results
  to the AnchorDesk probe device contract (v1) and pushes them to
  `POST /probe/devices` after each completed scan. Upsert-keyed (id falls back
  mac → ip) so re-scans update devices instead of duplicating them.
- Periodic `POST /probe/heartbeat` liveness reporting that carries the probe
  version and scanned CIDR.
- Flag and environment configuration for the AnchorDesk URL and probe API
  key (`-url`/`-key`, `NETVIZ_ANCHORDESK_URL`/`NETVIZ_ANCHORDESK_KEY`).
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
- Unit tests for the AnchorDesk transport client (`client.go`): header,
  non-2xx handling, and retry behavior.
- Probe deployment doc (service install, env/flag config, host-network note).
- Live meet-in-the-middle test against a running AnchorDesk: confirm
  `created > 0`, then `updated > 0` on re-scan with no duplicates.

Non-goals:

- Probe Docker image (decided against; host-network requirement makes it more
  footgun than convenience for the on-prem case).
- Standalone stdout JSON output (the AnchorDesk push is the reporting path;
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
- AnchorDesk push and heartbeat match the v1 contract and are documented.
  (done)
- Probe installs and runs as a Windows service, systemd unit, and launchd job.
  (implemented; systemd lifecycle passed, Windows registration reaches the
  native service manager and requires elevation as expected)
- Transport client has unit coverage. (done)
- Live AnchorDesk test passes: devices created on first scan, updated on
  re-scan, no duplicates. (done: 1 created, then 1 updated, 1 total device)

## v0.1.x: Desktop Probe Management (fast-follow)

Goal: make the desktop GUI the control surface for the headless probe service —
deploy it and edit its config — without the GUI ever running the report loop
itself. The service stays the durable runner; the GUI is a front-end.

Status: shipped as v0.2.0 on July 2, 2026, together with the desktop update
tab and a first visual contrast pass. The desktop Probe tab can locate the probe
binary, collect AnchorDesk URL/key/interval, use the current desktop CIDR,
install/start the persistent service, run a foreground `-once` push, and manage
start/stop/restart/uninstall/status. GUI-managed probes use a shared
service-readable config file and the service re-reads it before each scan
cycle. The desktop app also has an optional GitHub Releases updater that checks
for newer platform archives, prompts before download, and verifies checksums.
Last-push telemetry is still pending.

Features:

- Deploy from the GUI: install, start, stop, restart, status, and uninstall the
  `netviz-probe` service by invoking the same probe binary and service
  subcommands. Install requires elevation (UAC / root), which the GUI documents.
- Edit probe config from the GUI: AnchorDesk URL, probe key, CIDR, and
  interval. Repeating provisioning updates the shared config file and is
  idempotent for GUI-managed services.
- Shared config file in a system-wide, service-readable location (e.g.
  `ProgramData` on Windows, `/etc/netviz` on Linux) so the logged-in GUI user
  and the SYSTEM/root service account both reach the same file.
- Probe service reloads its config (re-reads on each cycle, or on change) so GUI
  edits take effect without a manual service restart.
- Service status in the GUI: installed/running state, last successful push, and
  online indication.
- Optional desktop update flow: check GitHub Releases, select the current
  platform archive, verify the `.sha256` checksum, and stage the download
  without silent installation.

Non-goals:

- GUI running the report/push loop in-process (rejected: a GUI needs a
  logged-in session; the headless service is the durable path).
- Multi-tenancy or probe enrollment.

Acceptance criteria:

- A tech can install, configure, and manage the probe service from the GUI when
  the desktop app is launched with service-manager privileges.
- Config edited in the GUI is picked up by the running service without a manual
  restart.

## v0.3.0: Server Ingest and Docker Web UI

Goal: add single-tenant server ingest and a useful containerized web UI.
(Renumbered from the original v0.1.5 milestone; v0.2.0 shipped desktop probe
management first.)

Status: shipped July 2, 2026.

Done:

- Go HTTP server mode: `netviz-server -addr -db -ingest-key`.
- Server accepts the same v1 probe wire contract as AnchorDesk
  (`POST /probe/devices`, `POST /probe/heartbeat`, `X-Probe-Key`), so an
  existing probe points at either backend unchanged. Ingest is deny-by-default
  until a key is configured.
- Each push is stored as a scan run with host observations in the shared
  SQLite store; retention pruning keeps the newest 500 runs so interval
  pushes cannot grow the database without bound.
- `GET /api/state` (latest run + devices + probe heartbeat) and real
  `GET /api/scans`.
- Embedded React web UI: stat tiles, probe heartbeat badge, device table,
  and an interactive canvas network map — hub-and-cluster constellation
  layout with phyllotaxis packing, bundled curved edges, breathing glow on
  live devices, hover tooltips, click-to-inspect, wheel zoom, drag pan, and
  a clickable category legend using the CVD-validated palette. `?demo`
  renders sample data for a first look without a probe.
- Docker image with a `/data` volume; compose file wires
  `NETVIZ_INGEST_KEY`. Web UI assets are committed to
  `internal/server/webdist` (rebuilt via `make build-web`) so `go build` and
  the Docker build never need node.
- Meet-in-the-middle test drives the real probe client against the server:
  created on first push, updated on re-push, no duplicates.

Non-goals:

- Multi-tenancy (dropped from the roadmap — see below).
- Web UI sign-in (v0.5.0 adds SSO; run the server on a trusted network until
  then).

Acceptance criteria:

- `docker run -p 8080:8080 ghcr.io/spillers-technology/netviz` serves the app. (done)
- Server accepts probe observations. (done: live smoke + contract tests)
- Latest network state renders in the web UI. (done)

## Dropped: Multi-Tenant Hosted Mode (was v0.1.9)

Multi-tenancy, probe enrollment, and per-tenant tokens are removed from the
NetViz roadmap. AnchorDesk owns tenancy: each probe is registered to one
company and pushes to that company's AnchorDesk backend with its own API key,
so syncing users get tenancy for free externally. A local-only NetViz server
is single-site by definition and would gain nothing but complexity.

## v0.4.0: Polish and Hardening

Goal: make NetViz reliable and pleasant enough for broader FOSS use.

Status: shipped July 2, 2026.

Done:

- Updater completion: Install and Restart extracts the desktop binary from
  the checksum-verified archive and swaps it in place (Windows helper waits
  for exit, swaps, relaunches; Linux renames immediately; previous binary is
  kept as a `.old` backup).
- Vendor enrichment: embedded IEEE OUI registry snapshot (~40k prefixes) in
  `internal/oui` behind the curated short-name table; classifier extended
  with more network/printer vendors.
- Per-device history in the detail panel from local SQLite history, with
  monitor-mode coalescing (identical scans extend the previous run instead
  of inserting) and retention pruning (newest 200 runs).
- Emoji device icons across the hierarchy circles, legends, group headers,
  and detail panel.
- UX and visibility pass: validated palette, focus states, legends
  (shipped through v0.2.0–v0.3.0 and this release).
- Release checklist added to RELEASING.md.

Deferred:

- Windows code signing and macOS notarization: requires certificates
  (an EV/OV code-signing cert and an Apple Developer ID). Tracked as a
  v1.0.0 acceptance criterion; everything codeable around it is done.
- Deep accessibility audit and performance profiling beyond the /24
  responsiveness bar — ongoing work, not release-gated here.

Non-goals:

- Expanding beyond authorized network visibility.
- Vulnerability scanning.

Acceptance criteria:

- Release artifacts are reproducible. (workflows are pinned; builds are
  deterministic modulo Go/wails toolchain versions)
- Common install paths are documented. (done)
- UI remains responsive during expected scans. (done for /24)

## v0.5.0: Server Sign-In and SSO

Goal: put the server web UI and read APIs behind authenticated sign-in so a
NetViz server can sit somewhere more hostile than a trusted LAN segment.
Required before 1.0.0.

Features:

- OIDC sign-in (Authorization Code + PKCE) against any standard identity
  provider (Entra ID, Google, Keycloak, Authentik), configured via
  issuer/client flags or environment.
- Secure cookie sessions with sensible expiry; logout.
- SAML2 support if a real deployment needs it — OIDC is the first-class
  path, SAML2 is demand-driven.
- Optional local break-glass admin credential for recovery when the IdP is
  unreachable, disabled by default.
- Probe endpoints keep `X-Probe-Key` auth — machines don't do SSO.
- Auth disabled mode preserved for trusted-LAN deployments, explicit and
  logged, never the silent default when an issuer is configured.

Non-goals:

- User management, roles, or per-user data (single-tenant remains).
- Multi-tenancy.

Acceptance criteria:

- With OIDC configured, all web/API routes except `/healthz` and the probe
  endpoints require a session.
- Sign-in round-trips against at least one real IdP and one local Keycloak.
- Session cookies are Secure, HttpOnly, SameSite; secrets never land in
  process listings.

## v1.0.0: Stability Freeze

Goal: commit to the compatibility guarantees that make NetViz safe to depend
on. Mostly declarations plus the tests and migrations that back them.

Features:

- AnchorDesk probe contract v1 frozen and documented; any change bumps the
  contract version on both sides together.
- Versioned formats with migration or an explicit compatibility statement:
  scan-data files, CSV export, probe config file, and the SQLite history
  schema.
- Documented semver policy: CLI flags, file formats, wire contract, and config
  are covered; internal Go packages are not.
- Security posture doc: probe threat model (API key on customer LANs, runs as
  SYSTEM/root), key rotation guidance, and a security review of the server
  ingest surface.
- Complete install and deployment docs for desktop, probe, and server on all
  supported platforms, with current screenshots.

Acceptance criteria:

- A tech can install a signed desktop app, deploy a probe to a customer site
  from the GUI, point it at a self-hosted Docker server or AnchorDesk, and
  later upgrade all three components without losing history or breaking the
  wire contract.
- A server exposed beyond a trusted LAN requires SSO sign-in (v0.5.0).
- `go test ./...`, `go vet ./...`, and frontend builds pass on all release
  platforms.
- Upgrading from the previous release preserves local history and probe
  config.
