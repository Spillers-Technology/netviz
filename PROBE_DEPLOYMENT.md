# Deploying the NetViz Probe

`netviz-probe` is the unattended NetViz scanner. It runs natively on a customer
LAN, scans one IPv4 CIDR on an interval, pushes inventory to MaterialTicket, and
sends heartbeat reports between scans.

Only scan networks you own or are authorized to assess.

## Before installation

1. Download the release archive for the host OS and architecture.
2. Move `netviz-probe` to a permanent location. The service registration uses
   the binary's current absolute path.
3. Obtain the MaterialTicket base URL and probe API key.
4. Choose the directly connected IPv4 CIDR to scan, such as
   `192.168.1.0/24`.
5. Run a foreground smoke test:

   ```sh
   netviz-probe -cidr 192.168.1.0/24 \
     -url https://rmm.example.com -key <probe-api-key> -once
   ```

The probe must have direct host-network access to the target CIDR and outbound
HTTP(S) access to MaterialTicket. It is intentionally distributed as a native
binary rather than a container because bridged container networking commonly
breaks ARP discovery and other LAN-local behavior.

## Windows service

Open PowerShell as Administrator, set the credentials for the install command,
and register the service:

```powershell
$env:NETVIZ_MATERIALTICKET_URL = "https://rmm.example.com"
$env:NETVIZ_MATERIALTICKET_KEY = "<probe-api-key>"

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
export NETVIZ_MATERIALTICKET_URL=https://rmm.example.com
export NETVIZ_MATERIALTICKET_KEY='<probe-api-key>'

sudo --preserve-env=NETVIZ_MATERIALTICKET_URL,NETVIZ_MATERIALTICKET_KEY \
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
export NETVIZ_MATERIALTICKET_URL=https://rmm.example.com
export NETVIZ_MATERIALTICKET_KEY='<probe-api-key>'

sudo --preserve-env=NETVIZ_MATERIALTICKET_URL,NETVIZ_MATERIALTICKET_KEY \
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
| MaterialTicket URL | `-url` | `NETVIZ_MATERIALTICKET_URL` |
| Probe API key | `-key` | `NETVIZ_MATERIALTICKET_KEY` |
| Scan/heartbeat interval | `-interval` | — |

For service installation, prefer environment variables for the URL and key so
the key is not recorded in shell history or the registered command line. The
installer copies those values into the native service definition. Treat the
host as credential-bearing infrastructure and rotate the probe key when the
host is retired or compromised.

To change the CIDR, interval, URL, or key in v0.1.0, stop and uninstall the
service, then install it again with the new values.

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
- A heartbeat or push failure means the host cannot reach MaterialTicket, the
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
