# Releasing NetViz

NetViz GitHub Actions are intentionally self-hosted only.

v0.0.1 is the first desktop release target. Release artifacts should be treated
as early FOSS builds: useful for local testing, not yet polished installers.

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
- probe placeholder binary
- desktop build output for that platform
- README, LICENSE, and milestone notes

The workflow also supports manual dispatch with a `tag` input to rebuild assets
for an existing release.

## v0.0.1 Checklist

- `go test ./...`
- `go vet ./...`
- `npm run --prefix desktop/frontend build`
- `npm run --prefix web build`
- `wails build` on available desktop platforms
- Smoke test CLI scan JSON events
- Smoke test desktop scan, monitor mode, graph, hierarchy, export, and history
- Confirm release notes mention authorized-use-only scanning
- Confirm [CHANGELOG.md](CHANGELOG.md) has the v0.0.1 notes
