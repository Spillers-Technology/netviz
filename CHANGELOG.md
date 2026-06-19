# Changelog

## v0.1.0 (in progress)

Adds the first `netviz-probe` headless scanner and its MaterialTicket
integration. A netviz instance deployed on a customer LAN can now act as a
probe: it scans the network and pushes the devices it finds to a MaterialTicket
backend, which upserts them and links them to tickets.

Added:

- `netviz-probe` headless scanner binary built on the shared scanner core, with
  no desktop/Wails/UI dependencies.
- `internal/materialticket` package: serializes host observations to the
  MaterialTicket probe device contract (v1) and provides a transport-only client
  for the probe ingest endpoints.
- Device push: `POST /probe/devices` after each completed scan. Records are
  keyed for upsert (id falls back mac → ip), so re-scanning updates devices
  rather than duplicating them.
- Heartbeat: periodic `POST /probe/heartbeat` carrying the probe version and
  scanned CIDR.
- Flag and environment configuration: `-cidr`, `-url`, `-key`, `-interval`, and
  `-once`, with `NETVIZ_MATERIALTICKET_URL` / `NETVIZ_MATERIALTICKET_KEY` env
  fallbacks that keep the API key out of process listings and shell history.
- Bounded-backoff retry that holds undelivered records for the next cycle
  instead of dropping them.

Notes:

- The probe authenticates to MaterialTicket with an API key issued once when an
  admin registers the probe; it is sent as the `X-Probe-Key` header.
- The wire contract is owned by MaterialTicket (`NETVIZ_CONTRACT_VERSION = 1`).
  Keep `internal/materialticket` in lockstep with its normalizer, or bump the
  contract version on both sides together.
- Standalone stdout JSON output and live per-device status streaming are not
  implemented yet.

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
