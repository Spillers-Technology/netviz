# Deploying the NetViz Probe

`netviz-probe` is the unattended NetViz scanner. It runs natively on a customer
LAN, scans one IPv4 CIDR on an interval, pushes inventory to its backend, and
sends heartbeat reports between scans.

The probe speaks one wire contract to two interchangeable backends: an
AnchorDesk instance, or a self-hosted `netviz-server` (Docker image at
`ghcr.io/spillers-technology/netviz` — see the README's Server mode section).
Everything in this guide applies to both; only the URL and key differ. For a
netviz-server backend the key is the server's `NETVIZ_INGEST_KEY`.

Only scan networks you own or are authorized to assess.

## Before installation

1. Download the release archive for the host OS and architecture.
2. Move `netviz-probe` to a permanent location. The service registration uses
   the binary's current absolute path.
3. Obtain the backend base URL and probe API key (AnchorDesk-issued, or the
   netviz-server ingest key).
4. Choose the directly connected IPv4 CIDR to scan, such as
   `192.168.1.0/24`.
5. Run a foreground smoke test:

   ```sh
   netviz-probe -cidr 192.168.1.0/24 \
     -url https://rmm.example.com -key <probe-api-key> -once
   ```

The probe must have direct host-network access to the target CIDR and outbound
HTTP(S) access to AnchorDesk. It is intentionally distributed as a native
binary rather than a container because bridged container networking commonly
breaks ARP discovery and other LAN-local behavior.

## Desktop GUI provisioning

The desktop app includes a **Probe** tab that can provision the same
`netviz-probe` service used by the command line:

1. Put `netviz` and `netviz-probe` in a stable location on the target machine.
   The GUI looks for `netviz-probe` next to the desktop app first; use
   **Choose** if the binary is elsewhere.
2. Open the desktop app with the privileges required by the host OS service
   manager. On Windows this usually means **Run as administrator**. On Linux
   and macOS, command-line installation with `sudo` is still the most reliable
   path unless the desktop session already has the needed service permissions.
3. Enter the scan CIDR in the main toolbar. The Probe tab uses that same CIDR.
4. Enter the AnchorDesk URL, probe API key, and scan/heartbeat interval.
5. Keep **Install persistent probe service** checked and click
   **Provision Probe**. The GUI writes a shared probe config file, installs the
   service as `netviz-probe run -config <path>`, then starts the service if
   **Start service after install** is checked.
6. Use **Refresh**, **Start**, **Stop**, **Restart**, or **Uninstall** in the
   Probe tab to manage the registered service.

When the Probe tab opens, it reads the existing shared config file and fills in
the CIDR, AnchorDesk URL, key, and interval. Repeating **Provision Probe** is
idempotent for GUI-managed probes: it updates the config file and keeps the
service pointed at the same file. The running service re-reads that file before
each scan cycle, so edits are picked up without a manual restart.

Uncheck **Install persistent probe service** to run a foreground `-once` push
from the GUI instead of installing the service. This is useful as a connectivity
smoke test, but it is not durable because it depends on the desktop session.

Legacy services installed before GUI config-file support may report running or
stopped, but their command-line/env configuration is not portable to read back
from every OS service manager. Click **Provision Probe** once from the GUI to
migrate them to the shared config-file layout.

## Windows service

Open PowerShell as Administrator, set the credentials for the install command,
and register the service:

```powershell
$env:NETVIZ_ANCHORDESK_URL = "https://rmm.example.com"
$env:NETVIZ_ANCHORDESK_KEY = "<probe-api-key>"

Set-Location "C:\Program Files\NetViz"
.\netviz-probe.exe install -cidr 192.168.1.0/24 -interval 1m
.\netviz-probe.exe start
.\netviz-probe.exe status
```

The service is named `netviz-probe`, starts automatically, and restarts after
an unexpected failure. Logs are written to Windows Event Viewer under
**Windows Logs → Application**, source `netviz-probe`.

To remove it:

```powershell
.\netviz-probe.exe stop
.\netviz-probe.exe uninstall
```

## Linux systemd service

Place the binary somewhere stable, for example `/usr/local/bin/netviz-probe`,
then run:

```sh
export NETVIZ_ANCHORDESK_URL=https://rmm.example.com
export NETVIZ_ANCHORDESK_KEY='<probe-api-key>'

sudo --preserve-env=NETVIZ_ANCHORDESK_URL,NETVIZ_ANCHORDESK_KEY \
  /usr/local/bin/netviz-probe install \
  -cidr 192.168.1.0/24 -interval 1m
sudo /usr/local/bin/netviz-probe start
sudo /usr/local/bin/netviz-probe status
```

The installer creates and enables `netviz-probe.service`. View logs with:

```sh
journalctl -u netviz-probe -f
```

To remove it:

```sh
sudo /usr/local/bin/netviz-probe stop
sudo /usr/local/bin/netviz-probe uninstall
```

## macOS launchd service

Place the binary somewhere stable, for example
`/usr/local/bin/netviz-probe`, then run:

```sh
export NETVIZ_ANCHORDESK_URL=https://rmm.example.com
export NETVIZ_ANCHORDESK_KEY='<probe-api-key>'

sudo --preserve-env=NETVIZ_ANCHORDESK_URL,NETVIZ_ANCHORDESK_KEY \
  /usr/local/bin/netviz-probe install \
  -cidr 192.168.1.0/24 -interval 1m
sudo /usr/local/bin/netviz-probe start
sudo /usr/local/bin/netviz-probe status
```

The installer creates `/Library/LaunchDaemons/netviz-probe.plist`. Follow live
messages in the macOS unified log:

```sh
log stream --predicate 'process == "netviz-probe"'
```

launchd also configures standard output and error paths under
`/var/log/netviz-probe.*.log`.

To remove it:

```sh
sudo /usr/local/bin/netviz-probe stop
sudo /usr/local/bin/netviz-probe uninstall
```

## Configuration and credentials

Foreground runs accept:

| Setting | Flag | Environment variable |
| --- | --- | --- |
| Network | `-cidr` | — |
| AnchorDesk URL | `-url` | `NETVIZ_ANCHORDESK_URL` |
| Probe API key | `-key` | `NETVIZ_ANCHORDESK_KEY` |
| Scan/heartbeat interval | `-interval` | — |
| Shared config file | `-config` | — |

For GUI-managed service installation, the URL and key are stored in a
service-readable JSON config file instead of the registered service command
line. By default the file is:

- Windows: `%ProgramData%\NetViz\probe.json`
- Linux: `/etc/netviz/probe.json`
- macOS: `/Library/Application Support/NetViz/probe.json`

Treat the host and config file as credential-bearing infrastructure and rotate
the probe key when the host is retired or compromised.

To change the CIDR, interval, URL, or key for a GUI-managed probe, edit the
Probe tab and click **Provision Probe**. The service re-reads the config before
its next scan cycle.

## Upgrade

1. Stop the service.
2. Replace the binary at the same path.
3. Start the service.
4. Confirm `status` reports `running` and check the platform log.

The service registration does not need to be recreated when only the binary
version changes.

## Troubleshooting

- `permission denied`, `access denied`, or an install failure usually means the
  terminal is not elevated.
- `service is not installed` means `install` has not completed for this binary.
- A heartbeat or push failure means the host cannot reach AnchorDesk, the
  URL is wrong, or the probe key was rejected.
- A scan failure usually means the CIDR is invalid or the service account lacks
  required local network access.
- If devices do not have MAC/vendor data, confirm the probe is on the same
  broadcast domain. Routed scans cannot use ARP across VLAN boundaries.
- The probe does not create inventory rows for addresses that have never
  responded. While running, it remembers discovered devices so a later silent
  scan can mark them down; that short-lived cache resets when the process
  restarts.
- v0.1.0 scans one CIDR. Deploy another probe for a separate LAN/VLAN.
