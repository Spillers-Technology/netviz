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

- CLI binary
- server binary
- headless probe binary with native service management
- desktop build output for that platform
- README, LICENSE, changelog, probe deployment guide, and milestone notes

The desktop updater depends on those asset names and matching `.sha256` files.
Before publishing a release, confirm the release includes the platform archive
for each supported runner and that the checksum file contains the SHA-256 digest
for that exact archive.

The workflow also supports manual dispatch with a `tag` input to rebuild assets
for an existing release.

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
