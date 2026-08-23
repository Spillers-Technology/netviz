# Releasing NetViz

NetViz GitHub Actions are intentionally self-hosted only.

Release artifacts are early FOSS builds. The desktop app is not yet a polished
signed installer; `netviz-probe` is a native binary with built-in service
registration.

## Required Runner Labels

Release builds target the standard self-hosted OS labels:

- `self-hosted`, `Linux`
- `self-hosted`, `Windows`
- `self-hosted`, `macOS`

GitHub Actions cannot dynamically skip missing self-hosted runner labels before a
job is queued. If one OS is not available, that job will remain queued until a
matching runner comes online.

## Runner Tooling

Each release runner should be able to install or run:

- Go 1.25.x through `actions/setup-go`
- Node 22 through `actions/setup-node`
- Wails v2 build prerequisites for that OS
- GitHub Actions checkout/setup actions

The Linux Docker publishing workflow also requires Docker/Buildx support on a
`self-hosted`, `Linux` runner.

Windows runners must use a tool cache path without spaces. The workflows set
`RUNNER_TOOL_CACHE` and `AGENT_TOOLSDIRECTORY` to `C:\actions-toolcache` for
Windows jobs because setup actions can fail when the runner lives under paths
such as `C:\Program Files\...`.

## Release Assets

When a GitHub Release is published, `.github/workflows/release.yml` builds and
uploads:

- `netviz-<tag>-linux-<arch>.tar.gz`
- `netviz-<tag>-darwin-<arch>.tar.gz`
- `netviz-<tag>-windows-<arch>.zip`
- matching `.sha256` files

Each archive contains:

- desktop app at the archive root (`netviz.exe`, `netviz`, or `netviz.app`)
- `bin/` with the CLI, server, and headless probe binaries
- README, LICENSE, changelog, probe deployment guide, and milestone notes

Windows zips are intentionally flat: after a normal "Extract All", users should
see `netviz.exe` immediately in the extracted folder, not buried under
`desktop/` or another app subdirectory. Keep auxiliary binaries in `bin/`.

The desktop updater depends on those asset names and matching `.sha256` files.
Before publishing a release, confirm the release includes the platform archive
for each supported runner and that the checksum file contains the SHA-256 digest
for that exact archive.

The workflow also supports manual dispatch with a `tag` input to rebuild assets
for an existing release.

When self-hosted runners are unavailable, `deploy/Dockerfile.release` builds
the Linux and Windows archives (plus `.sha256` files) from any Docker host —
usage is documented at the top of that file. Every release must ship its
platform archives; do not publish a release without them. macOS archives still
require a Mac.

## Release Checklist (every release)

Code health:

- `go test ./...` and `go vet ./...` at the repo root
- `cd desktop && go test ./...` (the desktop app is its own module)
- `npm run --prefix desktop/frontend build`
- `npm run --prefix web build` and commit any `internal/server/webdist` changes

Version and docs:

- Bump `internal/version/version.go` to the release version
- [CHANGELOG.md](CHANGELOG.md) entry with the release date — this is the sole
  release-notes location (per-version `RELEASE_NOTES_vX.Y.Z.md` files were
  retired after v0.2.0; do not add a new one)
- [MILESTONES.md](MILESTONES.md) status reflects what actually shipped
- README roadmap and feature text match the release

Functional spot checks:

- Desktop: scan a real /24; table, graph, and hierarchy stay responsive
- Server: `?demo` map renders; probe push creates then updates without
  duplicates; bad key gets 401; no key gets 503
- Probe: `-once` push against a live AnchorDesk or netviz-server
- Updater: Update tab detects the previous release, downloads, verifies the
  checksum, and Install and Restart swaps the binary (keep the `.old` backup)

Publishing:

- Tag `vX.Y.Z` on main; publish the GitHub Release (tag push publishes the
  Docker image; the release event builds platform archives)
- Confirm self-hosted runners are online — queued jobs mean a runner is down
- Confirm each platform archive and its `.sha256` attach to the release
- Release notes mention authorized-use-only scanning

## v0.1.0 Checklist

- `go test ./...`
- `go vet ./...`
- `npm run --prefix desktop/frontend build`
- `npm run --prefix web build`
- `wails build` on available desktop platforms
- Build `netviz-probe` for Windows, Linux, and macOS
- Install/start/status/stop/uninstall the probe on each release platform
- Run the probe twice against AnchorDesk and confirm the first ingest
  creates devices while the second updates the same devices without duplicates
- Confirm a bad probe key produces a useful non-2xx error
- Confirm platform service logs contain push and heartbeat results
- Confirm release notes mention authorized-use-only scanning
- Confirm [CHANGELOG.md](CHANGELOG.md) has the v0.1.0 notes
- Confirm [PROBE_DEPLOYMENT.md](PROBE_DEPLOYMENT.md) matches the shipped
  service commands
- Confirm the desktop Update tab detects the release, selects the current
  platform asset, downloads it, and verifies the `.sha256` checksum
