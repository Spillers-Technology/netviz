import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Link from "@mui/material/Link";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useColorScheme } from "@mui/material/styles";
import { ErrorNotice, PageHeader, StatusChip, monoFont, useConfirm } from "@netviz/ui";
import { MAX_PORTS } from "../settings";
import type { ScanState } from "../state/useScan";
import type { UpdatesState } from "../state/useUpdates";

export function SettingsWorkspace({ scan, updates, portsRef }: { scan: ScanState; updates: UpdatesState; portsRef: React.RefObject<HTMLElement | null> }) {
  const { mode, setMode } = useColorScheme();
  const confirm = useConfirm();
  const { info } = updates;

  async function install() {
    const ok = await confirm({
      title: `Install NetViz ${info.latest_version}?`,
      items: [
        "Replaces this copy of NetViz with the downloaded, checksum-verified release",
        "Keeps the current version next to it as a .old backup",
        "Restarts NetViz",
      ],
      body: "A scan in progress will stop. Saved history is kept.",
      confirmLabel: "Install and restart",
      mutating: true,
    });
    if (ok) await updates.apply();
  }

  const portSummary = scan.portsValid
    ? scan.portsCustomized
      ? `${scan.scanPorts.length} ports will be scanned.`
      : `Scanning the ${scan.portDefs.length || "default"} standard LAN ports.`
    : scan.scanPorts.length === 0
      ? "Choose at least one port."
      : `${scan.scanPorts.length} ports are chosen; the limit is ${MAX_PORTS}.`;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <PageHeader title="Settings" subtitle="Appearance, what a scan checks, and app updates." />
      <Stack spacing={2} sx={{ p: 3, overflow: "auto", flex: 1, maxWidth: 920 }}>
        <Paper component="section" aria-labelledby="appearance-heading" sx={{ p: 2 }}>
          <Typography id="appearance-heading" variant="h2" sx={{ mb: 1.5 }}>
            Appearance
          </Typography>
          <ToggleButtonGroup exclusive value={mode ?? "system"} onChange={(_, value) => value && setMode(value)} aria-label="Theme">
            <ToggleButton value="system">Match system</ToggleButton>
            <ToggleButton value="light">Light</ToggleButton>
            <ToggleButton value="dark">Dark</ToggleButton>
          </ToggleButtonGroup>
        </Paper>

        <Paper component="section" aria-labelledby="ports-heading" sx={{ p: 2 }} ref={portsRef} tabIndex={-1}>
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}>
            <Typography id="ports-heading" variant="h2">
              Scan ports
            </Typography>
            {scan.portsCustomized && (
              <Button
                onClick={() => {
                  scan.setDisabledPorts([]);
                  scan.setExtraPorts("");
                }}
              >
                Reset to defaults
              </Button>
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            NetViz checks these TCP ports on every address to recognize devices. Fewer ports make scans faster.
          </Typography>
          <ErrorNotice error={scan.portsError} />
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", columnGap: 1 }}>
            {scan.portDefs.map((def) => (
              <FormControlLabel
                key={def.port}
                control={
                  <Checkbox
                    size="small"
                    checked={!scan.disabledPorts.includes(def.port)}
                    onChange={(event) =>
                      scan.setDisabledPorts((current) => (event.target.checked ? current.filter((port) => port !== def.port) : [...current, def.port]))
                    }
                  />
                }
                label={
                  <span>
                    <Box component="span" sx={{ fontFamily: monoFont, fontWeight: 600 }}>
                      {def.port}
                    </Box>{" "}
                    <Box component="span" sx={{ color: "text.secondary" }}>
                      {def.service}
                    </Box>
                  </span>
                }
              />
            ))}
          </Box>
          <TextField
            label="Extra ports"
            placeholder="8006, 9443"
            value={scan.extraPorts}
            onChange={(event) => scan.setExtraPorts(event.target.value)}
            helperText="Separate with commas or spaces."
            sx={{ mt: 1.5, maxWidth: 320 }}
            fullWidth
            slotProps={{ htmlInput: { spellCheck: false } }}
          />
          <Typography variant="body2" sx={{ mt: 1 }} color={scan.portsValid ? "text.secondary" : "error"} role="status">
            {portSummary}
          </Typography>
        </Paper>

        <Paper component="section" aria-labelledby="updates-heading" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 1.5 }}>
            <Typography id="updates-heading" variant="h2">
              Updates
            </Typography>
            {updates.checked &&
              (info.available ? (
                <StatusChip tone="warning" label={`${info.latest_version} available`} />
              ) : (
                <StatusChip tone="success" label="Up to date" />
              ))}
          </Stack>
          {updates.busy && <LinearProgress aria-label="Working on the update" sx={{ mb: 1.5 }} />}
          <ErrorNotice error={updates.error} onClose={updates.clearError} />
          <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 2, rowGap: 0.75 }}>
            {[
              ["Installed", info.current_version || "Unknown"],
              ["Latest release", info.latest_version || (updates.checked ? "Unknown" : "Not checked yet")],
              ...(info.asset_name ? [["Download", info.asset_name]] : []),
              ...(info.download_path ? [["Saved to", info.download_path]] : []),
            ].map(([label, value]) => (
              <Box key={label} sx={{ display: "contents" }}>
                <Typography component="dt" variant="body2" color="text.secondary">
                  {label}
                </Typography>
                <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: "anywhere" }}>
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>
          {info.message && (
            <Alert severity="info" variant="outlined" sx={{ mt: 1.5, bgcolor: "background.paper" }}>
              {info.message}
            </Alert>
          )}
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", mt: 2 }} useFlexGap>
            {info.download_path ? (
              <>
                <Button variant="contained" onClick={() => void install()} disabled={updates.busy}>
                  Install and restart…
                </Button>
                <Button onClick={() => void updates.openDownload()} disabled={updates.busy}>
                  Show download
                </Button>
              </>
            ) : info.available ? (
              <Button variant="contained" onClick={() => void updates.download()} disabled={updates.busy}>
                Download {info.latest_version}
              </Button>
            ) : (
              <Button variant="outlined" onClick={() => void updates.check()} disabled={updates.busy}>
                Check for updates
              </Button>
            )}
            {info.release_url && (
              <Button component={Link} href={info.release_url} target="_blank" rel="noreferrer">
                Release notes
              </Button>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            Downloads are verified against the release checksum when one is published. Nothing downloads until you choose to.
          </Typography>
        </Paper>
      </Stack>
    </Box>
  );
}
