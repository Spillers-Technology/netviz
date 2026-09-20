# Releasing NetViz

NetViz GitHub Actions are intentionally self-hosted only.

Release artifacts are early FOSS builds. The desktop app is not yet a polished
signed installer; `netviz-probe` is a native binary with built-in service
registration.

## Required Runner Labels

Release builds target the standard self-hosted OS labels:

- `self-hosted`, `Linux`
- `self-hosted`, `Windows`

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

The `Linux` runner also needs the GTK 3 and WebKitGTK 4.1 development packages
for the Wails desktop build: `libgtk-3-dev` and `libwebkit2gtk-4.1-dev` on
Debian 13 / Ubuntu 24.04+. Those distributions have no `webkit2gtk-4.0`, which
is why the Linux builds pass `-tags webkit2_41` to `wails build`. The current
Linux runner is an unprivileged LXC container (Debian 13, nesting enabled for
Docker) on a Proxmox host, running the runner as a dedicated `runner` user under
systemd.

Windows runners must use a tool cache path without spaces. The workflows set
`RUNNER_TOOL_CACHE` and `AGENT_TOOLSDIRECTORY` to `C:\actions-toolcache` for
Windows jobs because setup actions can fail when the runner lives under paths
such as `C:\Program Files\...`.

The `Windows` runner also needs what code signing uses (see
[Windows Code Signing](#windows-code-signing)):

- PowerShell 7 (`pwsh`), which every Windows step already runs in
- The **Azure CLI** (`az`) on `PATH`: `azure/login` authenticates through it, and
  so does the signing action after it
- The .NET 8 runtime, which the Artifact Signing client library needs
- Outbound HTTPS to Azure, to `timestamp.acs.microsoft.com` (the timestamp
  countersignature) and to NuGet, from which the signing action fetches SignTool
  and its client library at run time

## Release Assets

When a GitHub Release is published, `.github/workflows/release.yml` builds and
uploads:

- `netviz-<tag>-linux-<arch>.tar.gz`
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
platform archives; do not publish a release without them. There is no macOS runner,
so no macOS archive is published.

**That fallback cannot sign.** It cross-compiles the Windows executables from
Linux, and Authenticode signing happens on the Windows runner. A Windows archive
from `Dockerfile.release` is unsigned, so it must not be published as a release
asset once releases are signed; bring the Windows runner back instead, or sign the
executables by hand (below) before archiving.

## Windows Code Signing

The Windows executables (`netviz.exe`, `netviz-cli.exe`, `netviz-server.exe`,
`netviz-probe.exe`) are Authenticode-signed with
[Azure Artifact Signing](https://learn.microsoft.com/azure/artifact-signing/).
The `build-windows` job signs them after building and before staging the archive,
so the zip and the SHA-256 the updater verifies describe the signed binaries. The
job fails rather than publish anything it could not sign.

- **Identity.** The workflow authenticates to Azure over OIDC with a federated
  credential; no secret is stored. It trusts exactly this repository's `release`
  environment, so only a job that declares `environment: release` can sign, and
  that environment accepts only `main` and `v*` tags.
- **Configuration** lives on the `release` environment (Settings → Environments):
  variables `SIGNING_ENDPOINT`, `SIGNING_ACCOUNT`, `SIGNING_PROFILE`,
  `SIGNING_EXPECTED_SUBJECT` and secrets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
  `AZURE_SUBSCRIPTION_ID`. The Azure side and these values were created by
  `scripts/setup-signing.ps1` in [spilloid/spoolsmith](https://github.com/spilloid/spoolsmith),
  which documents the whole setup in its `docs/code-signing.md`.
- **Try it without releasing.** Run the `Signing check` workflow
  (`gh workflow run signing-check.yml`). It builds and signs the same four
  executables and publishes nothing. Add `-f hosted=true` to run it on a
  GitHub-hosted runner, which tells a broken signing identity apart from a
  self-hosted runner that is missing a prerequisite.
- **Verify a download** with nothing installed but Windows:

  ```powershell
  ./scripts/verify-signature.ps1 -Files netviz/netviz.exe, netviz/bin/netviz-cli.exe
  ```

  Without a checkout, `Get-AuthenticodeSignature .\netviz.exe | Format-List Status,
  SignerCertificate` shows the same thing for one file. Every file must report a
  valid signature from the expected publisher, with a timestamp. The timestamp matters: Artifact Signing certificates last three
  days, so an untimestamped signature looks fine on release day and stops
  verifying a few days later.
- **Only signed builds stay on a release.** The `Release guard` workflow
  (`.github/workflows/release-guard.yml`) runs on a GitHub-hosted runner after
  `Release Builds` finishes, and on publish. It downloads every `.zip`/`.exe`/`.msi`
  asset, checks the zip against its `.sha256`, and verifies every executable inside
  with `scripts/verify-signature.ps1` against `SIGNING_EXPECTED_SUBJECT`. If a
  Windows archive is missing, unsigned, untimestamped or signed by the wrong
  publisher, it moves the release back to **draft**, which hides it from the public
  and from the desktop updater. Fix the assets and publish again. It cannot stop an
  upload, only what stays public: assets are attached after publishing. Re-run it
  by hand with `gh workflow run release-guard.yml -f tag=vX.Y.Z`.
- **Linux is not signed, and not covered by the guard.** There is no macOS
  archive: no macOS runner is available, and notarization is deferred (see
  [MILESTONES.md](MILESTONES.md)).
- **The publisher is an individual.** The certificate names its subject as an
  individual, so Windows shows that person as the publisher, not an organization.

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
- Run the `Signing check` workflow and confirm it passes before tagging
- Confirm each platform archive and its `.sha256` attach to the release
- Download the published Windows zip, extract it, and run
  `scripts/verify-signature.ps1` on `netviz.exe` and every `bin/*.exe` — CI
  verifies what it built; this verifies what users actually get
- Release notes mention authorized-use-only scanning

## v0.1.0 Checklist

- `go test ./...`
- `go vet ./...`
- `npm run --prefix desktop/frontend build`
- `npm run --prefix web build`
- `wails build` on available desktop platforms
- Build `netviz-probe` for Windows and Linux
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
