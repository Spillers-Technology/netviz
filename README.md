# NetViz

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
**[Releases page](https://github.com/spilloid/netviz/releases/latest)** — the
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
make build-server  # placeholder server (see roadmap)
make build-probe   # placeholder headless probe (see roadmap)
```

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

Future consumers    Headless probe reporter · server ingest endpoint
                    Web UI latest-state view · websocket event streamer
```

---

## Roadmap

- **v0.0.1** — desktop scanner, live monitoring, visualizations, history, CLI
  parity *(current)*
- **v0.0.2** — visual polish, packaging, signed installers, screenshots
- **v0.0.3** — history/diff UX and scan management
- **v0.1.0** — `netviz-probe` headless scanner that emits JSON
- **v0.1.5** — single-tenant server ingest + Docker image at
  `ghcr.io/spilloid/netviz`
- **v0.1.9** — multi-tenant hosted/server mode with probe enrollment
- **v0.2.0** — performance, accessibility, and docs

See [MILESTONES.md](MILESTONES.md) for acceptance criteria,
[CHANGELOG.md](CHANGELOG.md) for release notes, and
[RELEASING.md](RELEASING.md) for the build/release process.

---

## License

MIT. See [LICENSE](LICENSE).
