import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlined from "@mui/icons-material/VisibilityOffOutlined";
import RefreshOutlined from "@mui/icons-material/RefreshOutlined";
import { ErrorNotice, PageHeader, StatusChip, isValidCIDR, monoFont, useConfirm, useToast, type Tone } from "@netviz/ui";
import type { ProbeServiceStatus } from "../bridge";
import type { ProbeState } from "../state/useProbe";

const INTERVALS = ["30s", "1m", "5m", "15m"];

function probeTone(status: ProbeServiceStatus): { tone: Tone; label: string } {
  if (!status.found) return { tone: "error", label: "Probe not found" };
  if (status.state === "running") return { tone: "success", label: "Running" };
  if (status.state === "stopped") return { tone: "warning", label: "Stopped" };
  if (status.state === "not installed") return { tone: "neutral", label: "Not installed" };
  return { tone: "neutral", label: status.state ? status.state[0].toUpperCase() + status.state.slice(1) : "Unknown" };
}

export function ProbeWorkspace({ probe }: { probe: ProbeState }) {
  const confirm = useConfirm();
  const toast = useToast();
  const { status, form } = probe;
  const [showKey, setShowKey] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const installed = status.found && status.state !== "not installed" && status.state !== "unknown";
  const running = status.state === "running";
  const chip = probeTone(status);

  const missing = [
    !isValidCIDR(form.cidr) && "a network range",
    !form.url.trim() && "the server address",
    !form.key && "the probe key",
  ].filter(Boolean) as string[];

  const checks: { text: string; fix?: { label: string; onClick: () => void } }[] = [];
  if (probe.loaded && !status.found) {
    checks.push({ text: "netviz-probe wasn't found. It ships in the bin folder of the NetViz download.", fix: { label: "Locate netviz-probe…", onClick: () => void probe.locate() } });
  }
  if (missing.length) checks.push({ text: `Add ${missing.join(", ")} below.` });
  if (status.found && status.state === "not installed") checks.push({ text: "The probe service isn't installed yet. Fill in the connection below, then install it." });
  if (status.state === "stopped") checks.push({ text: "The probe service is installed but not running, so nothing is being reported.", fix: { label: "Start service", onClick: () => void probe.serviceAction("start") } });

  async function provision() {
    const items = form.installPersistent
      ? [
          `Copies netviz-probe to ${status.install_path || "the install location"}`,
          `Saves its settings to ${status.config_path || "the probe config file"}`,
          "Installs the NetViz probe as a service that starts with this PC",
          ...(form.startAfterInstall ? ["Starts the service now"] : []),
          `Reports ${form.cidr} to ${form.url} every ${form.interval}`,
        ]
      : [`Scans ${form.cidr} once`, `Sends the results to ${form.url}`, "Installs nothing"];
    const ok = await confirm({
      title: form.installPersistent ? "Install the probe?" : "Send one report?",
      body: form.installPersistent ? "Your system may ask for administrator rights. Nothing changes until you confirm." : "Nothing is installed.",
      items,
      confirmLabel: form.installPersistent ? "Install probe" : "Send report",
      mutating: true,
    });
    if (!ok) return;
    if (await probe.provision()) toast(form.installPersistent ? "Probe installed" : "Report sent");
  }

  async function uninstall() {
    const ok = await confirm({
      title: "Uninstall the probe?",
      items: ["Stops the probe service", "Removes the service from this PC", "Stops reporting this network"],
      body: "The server keeps the observations it already has.",
      confirmLabel: "Uninstall",
      destructive: true,
    });
    if (ok) await probe.serviceAction("uninstall");
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <PageHeader
        title="Probe"
        subtitle="Keep this network reporting to AnchorDesk or NetViz Server, even when this app is closed."
        status={probe.loaded ? <StatusChip tone={chip.tone} label={chip.label} /> : undefined}
        actions={
          <Button startIcon={<RefreshOutlined />} onClick={() => void probe.refresh()} disabled={probe.busy}>
            Refresh
          </Button>
        }
      />
      {probe.busy && <LinearProgress aria-label="Working on the probe" />}
      <Stack spacing={2} sx={{ p: 3, overflow: "auto", flex: 1, maxWidth: 1100 }}>
        <ErrorNotice error={probe.error} onClose={probe.clearError} />
        {probe.loaded && checks.length === 0 && running && (
          <Alert severity="success" variant="outlined" sx={{ bgcolor: "background.paper" }}>
            The probe is running and reports {form.cidr || "this network"} every {form.interval}.
          </Alert>
        )}
        {checks.length > 0 && (
          <Paper component="section" aria-labelledby="checks-heading" sx={{ p: 2, borderLeft: 4, borderLeftColor: "warning.main" }}>
            <Typography id="checks-heading" variant="h2" sx={{ mb: 1 }}>
              Finish setting up
            </Typography>
            <Stack spacing={1}>
              {checks.map((check) => (
                <Stack key={check.text} direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <Typography variant="body2" sx={{ flex: "1 1 320px" }}>
                    {check.text}
                  </Typography>
                  {check.fix && (
                    <Button variant="outlined" color="warning" onClick={check.fix.onClick} disabled={probe.busy}>
                      {check.fix.label}
                    </Button>
                  )}
                </Stack>
              ))}
            </Stack>
          </Paper>
        )}

        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, alignItems: "start" }}>
          <Paper component="section" aria-labelledby="connection-heading" sx={{ p: 2 }}>
            <Typography id="connection-heading" variant="h2" sx={{ mb: 2 }}>
              Connection
            </Typography>
            <Stack spacing={2}>
              <TextField
                label="Network range to report"
                value={form.cidr}
                onChange={(event) => form.setCidr(event.target.value)}
                error={Boolean(form.cidr) && !isValidCIDR(form.cidr)}
                helperText="The probe scans this range on its own schedule. It doesn't change the range on the Network page."
                slotProps={{ htmlInput: { spellCheck: false } }}
              />
              <TextField label="Server address" placeholder="https://rmm.example.com" value={form.url} onChange={(event) => form.setURL(event.target.value)} slotProps={{ htmlInput: { spellCheck: false } }} />
              <TextField
                label="Probe key"
                type={showKey ? "text" : "password"}
                value={form.key}
                onChange={(event) => form.setKey(event.target.value)}
                slotProps={{ input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton aria-label={showKey ? "Hide the probe key" : "Show the probe key"} onClick={() => setShowKey((value) => !value)} edge="end">
                        {showKey ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                } }}
              />
              <TextField select label="Report every" value={form.interval} onChange={(event) => form.setInterval(event.target.value)} sx={{ maxWidth: 200 }}>
                {[...new Set([...INTERVALS, form.interval])].map((value) => (
                  <MenuItem key={value} value={value}>
                    {value}
                  </MenuItem>
                ))}
              </TextField>
              <Box>
                <FormControlLabel
                  control={<Switch checked={form.installPersistent} onChange={(event) => form.setInstallPersistent(event.target.checked)} />}
                  label="Run as a service that starts with this PC"
                />
                {form.installPersistent && (
                  <FormControlLabel
                    control={<Switch checked={form.startAfterInstall} onChange={(event) => form.setStartAfterInstall(event.target.checked)} />}
                    label="Start the service right away"
                  />
                )}
              </Box>
              <Box>
                <Button variant="contained" onClick={() => void provision()} disabled={probe.busy || missing.length > 0 || !status.found}>
                  {form.installPersistent ? (installed ? "Update probe…" : "Install probe…") : "Send one report…"}
                </Button>
              </Box>
            </Stack>
          </Paper>

          <Paper component="section" aria-labelledby="service-heading" sx={{ p: 2 }}>
            <Typography id="service-heading" variant="h2" sx={{ mb: 2 }}>
              Service
            </Typography>
            <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 2, rowGap: 0.75 }}>
              {[
                ["Installed at", status.install_path],
                ["Settings file", status.config_path || status.config?.config_path],
                ["Probe program", probe.probePath],
              ].map(([label, value]) => (
                <Box key={label} sx={{ display: "contents" }}>
                  <Typography component="dt" variant="body2" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0, fontFamily: value ? monoFont : undefined, fontSize: 12.5, overflowWrap: "anywhere", color: value ? "text.primary" : "text.secondary" }}>
                    {value || "Not set"}
                  </Typography>
                </Box>
              ))}
            </Box>
            {installed && (
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", mt: 2 }} useFlexGap>
                {running ? (
                  <>
                    <Button variant="outlined" onClick={() => void probe.serviceAction("restart")} disabled={probe.busy}>
                      Restart
                    </Button>
                    <Button variant="outlined" onClick={() => void probe.serviceAction("stop")} disabled={probe.busy}>
                      Stop
                    </Button>
                  </>
                ) : (
                  <Button variant="outlined" onClick={() => void probe.serviceAction("start")} disabled={probe.busy}>
                    Start
                  </Button>
                )}
                <Button color="error" onClick={() => void uninstall()} disabled={probe.busy}>
                  Uninstall…
                </Button>
              </Stack>
            )}
            {(status.summary || status.message) && (
              <Alert
                severity={status.severity === "success" ? "success" : status.severity === "error" ? "error" : status.severity === "warning" ? "warning" : "info"}
                variant="outlined"
                sx={{ mt: 2, bgcolor: "background.paper" }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {status.summary || "Probe status"}
                </Typography>
                {status.message && status.message !== status.summary && <Typography variant="body2">{status.message}</Typography>}
                {status.output && (
                  <>
                    <Button size="small" color="inherit" onClick={() => setShowOutput((value) => !value)} aria-expanded={showOutput} sx={{ px: 0, mt: 0.5, textDecoration: "underline" }}>
                      {showOutput ? "Hide command output" : "Command output"}
                    </Button>
                    <Collapse in={showOutput}>
                      <Box component="pre" sx={{ m: 0, mt: 0.5, whiteSpace: "pre-wrap", fontSize: 12, fontFamily: monoFont }}>
                        {status.output}
                      </Box>
                    </Collapse>
                  </>
                )}
              </Alert>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
              Installing, starting, stopping and uninstalling may need administrator rights. Credentials stay in the probe's settings file on this PC.
            </Typography>
          </Paper>
        </Box>
      </Stack>
    </Box>
  );
}
