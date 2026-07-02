# Changelog

## v0.9.2 — 2026-07-02

Fixed:

- The black console window that flashed at every scan start (and kept
  flashing during scans) on Windows. The scanner's ARP-cache reads and the
  desktop's probe/updater child processes now run with CREATE_NO_WINDOW, so
  GUI users never see console flashes from subprocesses.
- ARP cache refresh eased from 350ms to 1s, cutting subprocess churn during
  scans without hurting enrichment freshness.

## v0.9.1 — 2026-07-02

Added:

- Self-contained update finalizer: Install and Restart now launches the
  staged new binary in `-apply-update` mode, which waits for the old
  process to release the executable, swaps it in with a `.old` backup, and
  relaunches — pure Go on every platform, no cmd/tasklist helper scripts.
  Leftover `.old`/`.new` files are cleaned up on the next normal start.
- GitHub Pages site refreshed for the v0.9 era: probe and server section
  (Docker, web network map, `?demo`, OIDC SSO), IEEE OUI vendor
  identification, per-device history, built-in updates, and the current
  roadmap through v1.0.0.

## v0.9.0 — 2026-07-02

Server SSO and the stability freeze. This is the release candidate feature
set for 1.0.0 — what remains for the major version is code signing,
notarization, and final validation, not features.

Added:

- OIDC sign-in for the server web UI and read APIs: standard Authorization
  Code + PKCE against any OIDC identity provider (Entra ID, Google,
  Keycloak, Authentik). Configure with `-oidc-issuer`, `-oidc-client-id`,
  `-public-url`, and `NETVIZ_OIDC_CLIENT_SECRET`; register
  `<public-url>/auth/callback` with the IdP.
- HMAC-signed session cookies (HttpOnly, SameSite=Lax, Secure over https,
  12h expiry). Set `NETVIZ_SESSION_SECRET` to keep sessions across
  restarts. `/auth/logout` signs out; `/api/me` reports identity and the
  web UI shows the signed-in user.
- Deny-by-default routing when OIDC is configured: unauthenticated API
  calls get 401, page loads redirect to sign-in; only `/healthz`, the
  key-authed probe endpoints, and the auth flow itself stay open. Without
  an issuer the server runs in trusted-LAN mode and logs that loudly.
- Full sign-in round-trip test against an in-process OIDC issuer with
  RSA-signed id_tokens: discovery, PKCE, state validation, token exchange,
  JWKS verification, session issuance, and bad-state rejection.
- SECURITY.md: security posture, component threat models (probe, server,
  desktop), key rotation guidance, and the frozen v1 wire contract.
- README compatibility and semver policy: what v1.0.0 guarantees (wire
  contract, CLI flags, file formats, history schema migration) and what it
  does not (internal Go packages).
- Compose file passes through the OIDC environment.

Notes:

- SAML2 is deferred until a real deployment needs it; the auth layer is
  provider-agnostic OIDC.
- Sessions use a per-boot secret when `NETVIZ_SESSION_SECRET` is unset,
  which signs everyone out on server restart.

## v0.4.0 — 2026-07-02

Polish and hardening: real vendor coverage, useful per-device history, a
finished updater, and friendlier visuals.

Added:

- Vendor enrichment now falls back to an embedded snapshot of the full IEEE
  OUI registry (~40k prefixes, `internal/oui`) when the curated short-name
  table misses. Classifier learned more vendors (MikroTik, Juniper, Aruba,
  Fortinet, HP Inc, Lexmark, Kyocera).
- Per-device history in the desktop detail panel: the last 25 stored
  observations of the selected device (status, ports, time range) straight
  from local SQLite history.
- Monitor-mode history coalescing: a scan whose host state is identical to
  the previous run extends that run instead of inserting a new one, so
  monitor mode records state changes rather than thousands of identical
  runs per day. Local history is also pruned to the newest 200 runs.
- Updater in-place install: Install and Restart extracts the desktop binary
  from the verified archive and swaps it in (on Windows via a helper that
  waits for exit, swaps, and relaunches; on Linux an immediate rename). The
  previous binary is kept alongside as a `.old` backup.
- Emoji device icons in the desktop hierarchy circles, legends, group
  headers, and the detail panel (🌐 💻 🐧 🍎 🖨️ 🎥 🖥️), with letter initials
  kept for unknown devices.
- A living release checklist in RELEASING.md.

Notes:

- Windows code signing and macOS notarization remain open and are tracked as
  a 1.0.0 gate — they need certificates, not code.
- The OUI snapshot adds ~380KB to binaries; regenerate it from the IEEE
  registry when refreshing.

## v0.3.0 — 2026-07-02

Adds single-tenant server ingest and a real web UI. A `netviz-probe` can now
push to a self-hosted `netviz-server` using the exact same wire contract it
uses for AnchorDesk — change the URL and key, nothing else.

Added:

- Server ingest: `POST /probe/devices` and `POST /probe/heartbeat` implement
  the v1 probe contract with `X-Probe-Key` auth. Ingest is deny-by-default:
  without `-ingest-key`/`NETVIZ_INGEST_KEY` the endpoints answer 503.
- Each device push is stored as a scan run with host observations in the
  shared SQLite store (`-db`, default `netviz-server.db`); retention pruning
  keeps the newest 500 runs.
- `GET /api/state` returns the latest run, its devices, and the most recent
  probe heartbeat; `GET /api/scans` lists stored runs.
- Embedded web UI (React, served from the binary): stat tiles, probe
  heartbeat freshness badge, sortable-density device table, and an
  interactive canvas network map — devices cluster by type around the LAN
  hub in a phyllotaxis layout with bundled curved edges, live-device glow,
  hover tooltips, click-to-inspect details, wheel zoom, drag pan, and a
  clickable category legend. Add `?demo` to the URL to preview the map with
  generated sample data.
- The map reuses the desktop's CVD-validated device-type palette; offline
  devices render as hollow rings so state never rides on color alone, and
  `prefers-reduced-motion` disables the ambient animation.
- Docker image now persists to a `/data` volume and the compose file wires
  `NETVIZ_INGEST_KEY`; the image publishes to
  `ghcr.io/spillers-technology/netviz` on release tags.
- `make build-web` rebuilds the web UI into `internal/server/webdist`
  (committed, so `go build` and the Docker build never need node).
- Storage: `PruneScanRuns` retention helper with tests.
- Meet-in-the-middle contract test drives the real probe client against the
  server: devices created on first push, updated on re-push, no duplicates.

Notes:

- The web UI has no sign-in yet; run the server on a trusted network. SSO
  (OIDC first-class) lands in v0.9.0 and is required before 1.0.0.
- Multi-tenancy is out of scope permanently — AnchorDesk owns tenancy.

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
