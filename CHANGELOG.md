# Changelog

## v0.2.0 — 2026-07-02

Added:

- Desktop Probe tab for provisioning `netviz-probe` from the GUI. The tab uses
  the current desktop CIDR, AnchorDesk URL/key, interval, and selected probe
  binary to either install/start the persistent service or send one foreground
  `-once` push.
- GUI service controls for `netviz-probe status`, `start`, `stop`, `restart`,
  and `uninstall`.
- Probe binary auto-detection next to the desktop app, plus a file picker for
  release layouts where the probe binary lives somewhere else.
- Shared probe config file support through `netviz-probe -config`. GUI
  provisioning writes the system-level config file, opens back to that existing
  config, and installs the service as `run -config <path>` so repeated
  provisioning converges on the same service definition.
- Running probes re-read the config file before each scan cycle, so GUI edits
  take effect without manually restarting the service.
- Desktop Update tab and startup update check. The app checks GitHub Releases,
  prompts only when an update is available, downloads the matching platform
  archive on request, verifies the release `.sha256` checksum when present, and
  stages the file in the user's NetViz update cache.
- Shared `internal/version` package so the desktop updater and probe heartbeat
  report the same release version.
- Desktop visual contrast pass with stronger borders, darker secondary text,
  clearer selected states, and more legible graph/hierarchy outlines.

Notes:

- The persistent GUI path stores the AnchorDesk URL/key in a service-readable
  config file instead of service command-line arguments. Treat that host and
  config file as credential-bearing infrastructure.
- Service install/start/stop/uninstall still rely on the host OS service
  manager and may require Administrator/root elevation.
- Legacy services installed only with command-line/env configuration cannot be
  fully reverse-engineered by the GUI; provisioning from the GUI migrates them
  to the shared config-file service shape.
- The updater stages verified release archives. Full in-place replacement of a
  running desktop executable remains a future installer/helper step.

## v0.1.0 — 2026-06-19

Adds the first `netviz-probe` headless scanner and its AnchorDesk
integration. A netviz instance deployed on a customer LAN can now act as a
probe: it scans the network and pushes the devices it finds to an AnchorDesk
backend, which upserts them and links them to tickets.

Added:

- `netviz-probe` headless scanner binary built on the shared scanner core, with
  no desktop/Wails/UI dependencies.
- `internal/anchordesk` package: serializes host observations to the
  AnchorDesk probe device contract (v1) and provides a transport-only client
  for the probe ingest endpoints.
- Device push: `POST /probe/devices` after each completed scan. Records are
  keyed for upsert (id falls back mac → ip), so re-scanning updates devices
  rather than duplicating them.
- Heartbeat: periodic `POST /probe/heartbeat` carrying the probe version and
  scanned CIDR.
- Flag and environment configuration: `-cidr`, `-url`, `-key`, `-interval`, and
  `-once`, with `NETVIZ_ANCHORDESK_URL` / `NETVIZ_ANCHORDESK_KEY` env
  fallbacks that keep the API key out of process listings and shell history.
- Bounded-backoff retry that holds undelivered records for the next cycle
  instead of dropping them.
- Inventory filtering that skips never-responsive CIDR addresses while still
  reporting previously observed devices as down on later scans.
- Native service management through the probe binary: `install`, `start`,
  `stop`, `restart`, `status`, and `uninstall` register and control a Windows
  service, Linux systemd unit, or macOS launchd daemon.
- Cross-platform deployment guide covering credentials, host-network
  requirements, logging, upgrades, and troubleshooting.
- Transport and retry tests for authentication headers, heartbeat/device
  payloads, non-2xx responses, held batches, merge behavior, and backoff reset.

Notes:

- The probe authenticates to AnchorDesk with an API key issued once when an
  admin registers the probe; it is sent as the `X-Probe-Key` header.
- The wire contract is owned by AnchorDesk (`NETVIZ_CONTRACT_VERSION = 1`).
  Keep `internal/anchordesk` in lockstep with its normalizer, or bump the
  contract version on both sides together.
- Standalone stdout JSON output and live per-device status streaming are not
  v0.1.0 features.

## v0.0.1

Initial desktop release target.

This release is larger than the original table-only milestone. The visual layer
became the core product experience, so graphing, hierarchy visualization,
monitoring, history, and CLI parity were pulled into v0.0.1.

Added:

- Native Go TCP-connect scanner for constrained LAN-oriented default ports.
- CIDR validation and bounded concurrency.
- Typed scan events: scan lifecycle, host discovery, hostname resolution, host
  enrichment, open ports, classification, host completion, and scan completion.
- Best-effort hostname resolution.
- Best-effort MAC/vendor enrichment from the local ARP cache.
- Device classification from open ports plus simple vendor/hostname hints.
- Wails desktop app.
- Live table view.
- Grouped graph view with clickable device details.
- Hierarchy visualization with firewall/root node and compact device circles.
- Checked-only/offline filtering in hierarchy view.
- Checked-only dead addresses hidden by default across the main views.
- Monitor mode with new, online, offline, changed, and stable device states.
- File menu actions for opening saved scan data, saving scan data, and saving
  CSV.
- SQLite local scan history.
- Latest-run diff support.
- CLI `scan`, `scan -save`, `history`, and `diff` commands.
- Placeholder server mode with `/healthz`, `/api/version`, `/api/scans`, and `/`.
- Dockerfile and compose file for server mode.
- Static `/docs` landing page for GitHub Pages.
- Self-hosted GitHub Actions for CI, Docker publish, desktop builds, and release
  artifacts.

Known limitations:

- Visualizations are useful but still early.
- Device classification is intentionally conservative and simple.
- MAC/vendor enrichment depends on the local operating system ARP cache.
- Server/probe ingest is not implemented yet.
- Installers/signing/notarization are not polished yet.
- This is not a vulnerability scanner, RMM, credential tool, or Nmap wrapper.

See [RELEASE_NOTES_v0.0.1.md](RELEASE_NOTES_v0.0.1.md) for product-facing
release notes.
