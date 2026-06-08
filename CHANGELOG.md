# Changelog

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
