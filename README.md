# NetViz
<img width="1448" height="1086" alt="image" src="https://github.com/user-attachments/assets/3705d105-b775-4306-9368-a8ac756bec67" />

**See everything on your local network — in seconds, with one download.**

NetViz is a free, open-source LAN scanner and network visualizer for Windows,
macOS, and Linux. Point it at your network, hit scan, and watch devices appear
live as tables, a grouped graph, and a clickable hierarchy map. It's a modern
take on tools like Advanced IP Scanner and Angry IP Scanner, built on a fast
native Go scan engine.

No agents. No accounts. No Nmap. Just download and run.

> **Authorized use only.** Scan networks you own or have explicit permission to
> scan.

---

## Download

Grab the latest build for your platform from the
**[Releases page](https://github.com/Spillers-Technology/netviz/releases/latest)** — the
desktop app is ready to run, no toolchain required.

| Platform | Download | Run |
| --- | --- | --- |
| **Windows** | `netviz-<version>-windows-amd64.zip` | Unzip, open `desktop/`, run **`netviz.exe`** |
| **macOS** | `netviz-<version>-darwin-arm64.tar.gz` (Apple Silicon) or `-amd64` (Intel) | Extract, then open **`netviz.app`** |
| **Linux** | `netviz-<version>-linux-amd64.tar.gz` | Extract, then run **`./desktop/netviz`** |

Each archive also bundles the `netviz-cli` command-line scanner (see
[CLI](#command-line) below) plus a SHA-256 checksum file to verify your
download.

### First-launch notes

These are early FOSS builds and aren't code-signed yet, so your OS may warn you
the first time:

- **Windows** — SmartScreen may show "Windows protected your PC." Click **More
  info → Run anyway**.
- **macOS** — Gatekeeper may say the app is from an unidentified developer.
  **Right-click `netviz.app` → Open**, then confirm. (Or `xattr -dr
  com.apple.quarantine netviz.app`.)
- **Linux** — make sure the binary is executable: `chmod +x desktop/netviz`.

---

## What it does

- **Live LAN discovery** — enter a CIDR (e.g. `192.168.1.0/24`), and NetViz
  TCP-connect scans a focused set of common LAN ports while results stream in.
- **Three views of one scan:**
  - **Table** — IP, hostname, MAC, vendor, alive status, open ports, guessed
    device type, first-seen and last-updated timestamps.
  - **Graph** — devices grouped by inferred category with open-port badges.
  - **Hierarchy map** — a firewall/root node at the center with clickable device
    circles around it, built to stay readable on `/24` scans.
- **Monitor mode** — re-scans on an interval and flags devices as **new,
  online, offline, changed,** or **stable** so you can watch the network move.
- **Best-effort enrichment** — hostname resolution plus MAC/vendor lookup from
  your local ARP cache.
- **Save, open, and export** — save and reopen scans as NetViz JSON, or export
  to CSV from the File menu.
- **Local history** — completed scans are stored in a local SQLite database, and
  NetViz can diff the two most recent runs.
- **Probe setup from the desktop app** — configure AnchorDesk reporting
  details in the Probe tab and install/start the persistent `netviz-probe`
  service using the current CIDR. GUI-managed probes use a shared config file
  so reopening the app shows the existing probe settings.
- **Optional updates** — the desktop app checks GitHub Releases, prompts when a
  newer platform build is available, downloads on request, and verifies the
  release checksum when one is published.

NetViz is intentionally focused. It is **not** an Nmap wrapper, vulnerability
scanner, credential tool, remote shell, or RMM platform. No raw packet scanning,
no SYN scans, no remote command execution.

---

## Command line

Every release archive includes `netviz-cli`, which uses the same scan engine and
history store as the desktop app:

```sh
# Stream scan results as JSON
netviz-cli scan -cidr 192.168.1.0/24

# Save a scan to local history, then review it
netviz-cli scan -cidr 192.168.1.0/24 -save
netviz-cli history
netviz-cli diff
```

---

## Headless probe

`netviz-probe` is a headless build of the scanner for unattended use on a LAN.
It runs the same scan engine as the desktop app and CLI, then pushes the devices
it finds to a **AnchorDesk** backend — so a NetViz instance deployed on a
customer network can feed live device inventory into tickets.

```sh
# Scan once, push the results, then exit
netviz-probe -cidr 192.168.1.0/24 \
  -url https://rmm.example.com -key <probe-api-key> -once

# Run continuously: re-scan + push on an interval, with heartbeats in between
netviz-probe -cidr 192.168.1.0/24 -interval 60s \
  -url https://rmm.example.com -key <probe-api-key>

# Install the same configuration as an OS service (run as Administrator/root)
export NETVIZ_ANCHORDESK_URL=https://rmm.example.com
export NETVIZ_ANCHORDESK_KEY=<probe-api-key>
sudo --preserve-env=NETVIZ_ANCHORDESK_URL,NETVIZ_ANCHORDESK_KEY \
  ./netviz-probe install -cidr 192.168.1.0/24 -interval 60s
sudo ./netviz-probe start
sudo ./netviz-probe status
```

| Flag | Purpose |
| --- | --- |
| `-cidr` | IPv4 CIDR to scan (required) |
| `-url` | AnchorDesk base URL (or `NETVIZ_ANCHORDESK_URL`) |
| `-key` | Probe API key, sent as `X-Probe-Key` (or `NETVIZ_ANCHORDESK_KEY`) |
| `-interval` | Heartbeat / re-scan interval (default `1m`) |
| `-config` | Shared JSON config file for service/GUI-managed probes |
| `-once` | Scan once, push, and exit instead of running continuously |

Service commands are `install`, `start`, `stop`, `restart`, `status`, and
`uninstall`. The same binary registers a native Windows service, systemd unit,
or launchd daemon. Put the binary in its permanent location before installing
because the service registration points to that exact path.

The URL and key can come from the environment (`NETVIZ_ANCHORDESK_URL`,
`NETVIZ_ANCHORDESK_KEY`) or from a shared config file. The API key is issued
once when an admin registers the probe in AnchorDesk. After each scan the probe
`POST`s its devices to `/probe/devices` (upsert-keyed, so re-scans don't
duplicate) and keeps itself marked online via periodic `/probe/heartbeat`. A
failed push is retried on the next cycle, not dropped. The probe has no desktop,
Wails, or UI dependencies.

See [PROBE_DEPLOYMENT.md](PROBE_DEPLOYMENT.md) for complete Windows, Linux, and
macOS GUI/CLI install, logging, upgrade, and troubleshooting instructions.

---

## Build from source

You only need this if you want to develop NetViz or build it yourself — most
people should just [download a release](#download).

**Prerequisites:** Go 1.25+, Node.js + npm, and the
[Wails v2](https://wails.io/) CLI.

```sh
# Run the desktop app in dev mode
npm ci --prefix desktop/frontend
cd desktop && wails dev

# Or produce a packaged build
make build-desktop
```

Other targets:

```sh
make test          # go test ./...
make lint          # go vet ./...
make build-cli     # native CLI scanner
make build-server  # netviz-server: probe ingest + web UI
make build-probe   # netviz-probe headless scanner (see "Headless probe" above)
make build-web     # rebuild the server web UI into internal/server/webdist
```

### Server mode

`netviz-server` accepts device pushes from `netviz-probe` (the same v1 wire
contract used for AnchorDesk) and serves the latest network state as a web UI
with an interactive canvas network map:

```sh
docker run -p 8080:8080 -e NETVIZ_INGEST_KEY=your-probe-key \
  -v netviz-data:/data ghcr.io/spillers-technology/netviz

# then point a probe at it
netviz-probe -url http://server-host:8080 -key your-probe-key -cidr 192.168.1.0/24
```

Probe endpoints are disabled until an ingest key is configured
(`-ingest-key` or `NETVIZ_INGEST_KEY`). Open `http://server-host:8080/?demo`
to preview the map with sample data before wiring a probe.

To require SSO sign-in for the web UI and read APIs, point the server at any
OIDC identity provider (Entra ID, Google, Keycloak, Authentik):

```sh
netviz-server -oidc-issuer https://login.example.com/realms/main \
  -oidc-client-id netviz -public-url https://netviz.example.com
# NETVIZ_OIDC_CLIENT_SECRET and NETVIZ_SESSION_SECRET via environment
```

Register `<public-url>/auth/callback` as the redirect URI with your IdP.
Without `-oidc-issuer` the server runs in trusted-LAN mode (no web sign-in)
and says so at startup. Probe endpoints always authenticate with the ingest
key — machines don't do SSO.

The SQLite history store uses the pure-Go `modernc.org/sqlite` driver, so no
CGO is required.

---

## Architecture

NetViz is built around one rule:

```text
ScanEngine -> EventBus -> Consumers
```

The scanner core (`internal/scanner`) has no dependency on Wails, React, the
HTTP server, storage, or UI code. Every view — table, graph, hierarchy, CLI
JSON, file export, and SQLite history — consumes the same typed event stream.

```text
Current consumers   Desktop table · grouped graph · hierarchy map
                    CLI JSON output · file save/open · CSV export
                    SQLite history + diff · monitor mode
                    netviz-probe AnchorDesk reporter
                    netviz-server ingest + web UI network map

Future consumers    websocket event streamer
```

---

## Roadmap

- **v0.0.1** — desktop scanner, live monitoring, visualizations, history, CLI
  parity
- **v0.0.2** — visual polish, packaging, signed installers, screenshots
- **v0.0.3** — history/diff UX and scan management
- **v0.1.0** — `netviz-probe` headless scanner with AnchorDesk device push
  and heartbeat reporting
- **v0.2.0** — desktop probe management GUI and release updater
- **v0.3.0** — single-tenant server ingest, web UI network map, and Docker
  image at `ghcr.io/spillers-technology/netviz`
- **v0.4.0** — vendor enrichment (IEEE OUI), per-device history, updater
  in-place install, emoji device icons
- **v0.9.x** — server sign-in with OIDC SSO, stability-freeze docs,
  self-contained updates, and desktop UX fixes *(current)*
- **v1.0.0** — signed/notarized binaries on the frozen v0.9 feature set

See [MILESTONES.md](MILESTONES.md) for acceptance criteria,
[CHANGELOG.md](CHANGELOG.md) for release notes, and
[RELEASING.md](RELEASING.md) for the build/release process.

---

## Compatibility and semver

From v1.0.0, NetViz follows semantic versioning over these surfaces:

- **Probe wire contract v1** (`/probe/devices`, `/probe/heartbeat`,
  `X-Probe-Key`, shapes in `internal/anchordesk`): frozen; breaking changes
  bump the contract version on both ends together.
- **CLI flags** for `netviz-cli`, `netviz-probe`, and `netviz-server`:
  existing flags keep their meaning; removals are major-version events.
- **File formats**: saved scan JSON, CSV export, and the probe config file
  stay readable across minor versions.
- **SQLite history schema**: migrated in place on open; upgrading NetViz
  never loses local history.

Internal Go packages (`internal/...`) are **not** a supported API surface.
Security posture and threat model live in [SECURITY.md](SECURITY.md).

---

## License

MIT. See [LICENSE](LICENSE).
