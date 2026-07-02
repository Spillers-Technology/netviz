# NetViz v0.2.0

NetViz v0.2.0 makes the desktop app the control surface for persistent LAN
probe deployments. A technician can configure AnchorDesk reporting, install and
manage the `netviz-probe` service, reopen the app later to see the existing
configuration, and keep the desktop app current through a prompt-based updater.

## Highlights

- New **Probe** tab in the desktop app for configuring AnchorDesk URL, probe
  API key, CIDR, interval, and the local `netviz-probe` binary.
- Persistent probe installation from the GUI using the same native service path
  as the CLI on Windows, Linux/systemd, and macOS/launchd.
- Shared service-readable probe config file:
  - Windows: `%ProgramData%\NetViz\probe.json`
  - Linux: `/etc/netviz/probe.json`
  - macOS: `/Library/Application Support/NetViz/probe.json`
- Idempotent GUI provisioning: reopening the Probe tab loads the existing
  config, and provisioning again updates the same config/service shape.
- Running probes re-read config before each scan cycle, so GUI edits take
  effect without manually restarting the service.
- AnchorDesk branding throughout the probe contract, CLI help, docs, and GUI.
- New **Update** tab and startup update check. Updates are prompt-based:
  NetViz checks GitHub Releases, downloads only on request, verifies the
  `.sha256` checksum when available, and stages the release archive.
- Higher-contrast desktop visuals with stronger borders, selected states, graph
  cards, hierarchy outlines, and status panels.

## Probe GUI Flow

1. Build or place `netviz-probe` on the target machine.
2. Open NetViz with service-manager privileges when installing or uninstalling
   the persistent service.
3. Open the **Probe** tab, choose the probe binary if needed, and enter the
   AnchorDesk URL/key, CIDR, and interval.
4. Click **Provision Probe**.

The Probe tab now shows clear outcome cards for install/start/status actions,
with command details tucked behind an expandable section for troubleshooting.

## Upgrade Notes

Older probes installed only with command-line flags and environment variables
cannot be fully read back from every operating system service manager. Running
**Provision Probe** once from v0.2.0 migrates the machine to the shared
config-file layout.

The updater stages verified release archives. Fully replacing a running desktop
binary remains a future installer/helper step.

## Security

Probe config files contain the AnchorDesk probe key. Treat a configured probe
host as credential-bearing infrastructure and rotate keys when hosts are
retired or compromised.

Only scan networks you own or are explicitly authorized to assess.
