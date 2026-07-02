# NetViz Security Posture

NetViz scans networks. Only scan networks you own or are explicitly
authorized to scan. The scanner is intentionally limited to CIDR/range
discovery, TCP-connect scanning of known ports, hostname resolution,
ARP-cache enrichment, event streaming, export, local history, and
visualization. There is no raw packet scanning, no SYN scanning, no
vulnerability scanning, no remote shell, no remote command execution, and no
credential collection — and no plans to add them.

## Reporting a vulnerability

Open a GitHub security advisory on this repository, or email the maintainer
listed in the repository profile. Please do not open a public issue for
anything exploitable.

## Threat model

### Probe (`netviz-probe`)

The probe is the most exposed component: it runs unattended on customer
LANs, usually as SYSTEM (Windows service) or root (systemd/launchd), and
holds an API key.

- The probe key is written to a service-readable config file
  (`ProgramData\netviz` on Windows, `/etc/netviz` on Linux). Treat the host
  and that file as credential-bearing infrastructure; filesystem ACLs are
  the boundary.
- Keys are passed via config file or environment (`NETVIZ_ANCHORDESK_KEY`),
  never on the service command line, to keep them out of process listings.
- The probe only makes outbound HTTPS/HTTP requests to its configured
  backend. It has no listener, no control channel, and cannot be commanded
  remotely — a compromised backend can at most receive inventory.
- Key rotation: issue a new key on the backend, update the config file (or
  re-provision from the desktop GUI), and the running service picks it up on
  the next cycle. Revoke the old key afterward.

### Server (`netviz-server`)

- Probe ingest is deny-by-default: without a configured ingest key the
  endpoints answer 503. Keys are compared in constant time.
- The web UI and read APIs support OIDC SSO (Authorization Code + PKCE,
  HttpOnly SameSite=Lax cookies, Secure when served over HTTPS). Running
  without OIDC is an explicit trusted-LAN mode and is logged loudly at
  startup; do not expose an unauthenticated server beyond a trusted
  network.
- Session cookies are HMAC-SHA256 signed. Set `NETVIZ_SESSION_SECRET` for
  sessions that survive restarts; otherwise a per-boot secret is generated.
- Device pushes are size-capped (decompression/flood guard) and stored in
  SQLite with retention pruning.
- The server never executes anything based on ingested data; observations
  are inert rows rendered into a UI.

### Desktop

- Scan history lives in the user's config directory in SQLite; it contains
  network inventory, not credentials.
- The updater downloads release archives from GitHub over HTTPS, verifies
  the release `.sha256` checksum before install, and keeps the previous
  binary as a `.old` backup. Binaries are not yet code-signed; signing and
  notarization are the remaining v1.0.0 gate.

## Wire contract

The probe wire contract (v1) is frozen: `POST /probe/devices` and
`POST /probe/heartbeat` with `X-Probe-Key`, shapes defined in
`internal/anchordesk`. Any breaking change bumps the contract version on
both sides together. AnchorDesk owns tenancy; NetViz is single-site by
design and stores no tenant data.
