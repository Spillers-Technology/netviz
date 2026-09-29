import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import DeleteOutlineOutlined from "@mui/icons-material/DeleteOutlineOutlined";
import HistoryOutlined from "@mui/icons-material/HistoryOutlined";
import RefreshOutlined from "@mui/icons-material/RefreshOutlined";
import CompareArrowsOutlined from "@mui/icons-material/CompareArrowsOutlined";
import {
  EmptyState,
  ErrorNotice,
  PageHeader,
  hostLabel,
  monoFont,
  useAsyncAction,
  useConfirm,
  useToast,
  type HostObservation,
  type ScanRun,
} from "@netviz/ui";
import { app, type HostChange, type ScanDiff } from "../bridge";
import type { HistoryState } from "../state/useHistoryRuns";

function runLabel(run: ScanRun) {
  return `${new Date(run.started_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${run.cidr}`;
}

export function HistoryWorkspace({ history, onGoToNetwork }: { history: HistoryState; onGoToNetwork: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const action = useAsyncAction("That history action");
  const [baseID, setBaseID] = useState("");
  const [compareID, setCompareID] = useState("");
  const [customDiff, setCustomDiff] = useState<ScanDiff | null>(null);
  const { runs, latest, load } = history;

  // Default the comparison to the two most recent runs.
  useEffect(() => {
    if (runs.length >= 2) {
      setBaseID((current) => (runs.some((run) => run.id === current) ? current : runs[1].id));
      setCompareID((current) => (runs.some((run) => run.id === current) ? current : runs[0].id));
    }
  }, [runs]);

  async function compare() {
    const diff = await action.run(() => app().DiffRuns(baseID, compareID), "Comparing the scans");
    if (diff) setCustomDiff(diff);
  }

  async function remove(run: ScanRun) {
    const ok = await confirm({
      title: "Delete this saved scan?",
      body: `${runLabel(run)} will be removed from this PC's history. Devices keep their other saved observations.`,
      confirmLabel: "Delete scan",
      destructive: true,
    });
    if (!ok) return;
    const done = await action.run(async () => {
      await app().DeleteRun(run.id);
      return true;
    }, "Deleting the scan");
    if (!done) return;
    if (customDiff && (customDiff.base_run_id === run.id || customDiff.compare_run_id === run.id)) setCustomDiff(null);
    toast("Saved scan deleted");
    void history.refresh();
  }

  const diff = customDiff || latest;
  const base = runs.find((run) => run.id === diff.base_run_id);
  const target = runs.find((run) => run.id === diff.compare_run_id);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <PageHeader
        title="History"
        subtitle="Every finished scan is saved on this PC. Compare two to see what joined, left or changed."
        actions={
          <Button startIcon={<RefreshOutlined />} onClick={() => void history.refresh()}>
            Refresh
          </Button>
        }
      />
      {load.status === "loading" && <LinearProgress aria-label="Loading saved scans" />}
      <Stack spacing={2} sx={{ p: 3, overflow: "auto", flex: 1 }}>
        {load.status === "error" && <ErrorNotice error={load.error} />}
        <ErrorNotice error={action.error} onClose={action.clear} />
        {load.status === "ready" && runs.length === 0 ? (
          <EmptyState icon={HistoryOutlined} title="No saved scans yet" action={<Button variant="contained" onClick={onGoToNetwork}>Go to Network</Button>}>
            Scans are saved here automatically when they finish.
          </EmptyState>
        ) : (
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "minmax(360px, 5fr) 7fr" }, alignItems: "start" }}>
            <Paper component="section" aria-labelledby="runs-heading">
              <Typography id="runs-heading" variant="h2" sx={{ p: 2, pb: 1 }}>
                Saved scans
              </Typography>
              <Table aria-labelledby="runs-heading">
                <TableHead>
                  <TableRow>
                    <TableCell>When</TableCell>
                    <TableCell>Range</TableCell>
                    <TableCell align="right">Up</TableCell>
                    <TableCell align="right">Ports</TableCell>
                    <TableCell padding="checkbox" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id} hover>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {new Date(run.started_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </TableCell>
                      <TableCell sx={{ fontFamily: monoFont, fontSize: 12.5 }}>{run.cidr}</TableCell>
                      <TableCell align="right">{run.alive_count}</TableCell>
                      <TableCell align="right">{run.open_port_count}</TableCell>
                      <TableCell padding="checkbox">
                        <Tooltip title="Delete this scan…">
                          <IconButton aria-label={`Delete the scan from ${runLabel(run)}`} onClick={() => void remove(run)} disabled={action.busy}>
                            <DeleteOutlineOutlined fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>

            <Paper component="section" aria-labelledby="diff-heading" sx={{ p: 2 }}>
              <Typography id="diff-heading" variant="h2">
                What changed
              </Typography>
              {runs.length < 2 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Run another scan and NetViz will show what's different.
                </Typography>
              ) : (
                <>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mt: 1.5 }}>
                    <TextField select label="From" value={baseID} onChange={(event) => setBaseID(event.target.value)} sx={{ minWidth: 220 }}>
                      {runs.map((run) => (
                        <MenuItem key={run.id} value={run.id}>
                          {runLabel(run)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField select label="To" value={compareID} onChange={(event) => setCompareID(event.target.value)} sx={{ minWidth: 220 }}>
                      {runs.map((run) => (
                        <MenuItem key={run.id} value={run.id}>
                          {runLabel(run)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Button
                      variant="outlined"
                      startIcon={<CompareArrowsOutlined />}
                      onClick={() => void compare()}
                      disabled={!baseID || !compareID || baseID === compareID || action.busy}
                      sx={{ height: 40 }}
                    >
                      Compare
                    </Button>
                    {customDiff && <Button onClick={() => setCustomDiff(null)}>Back to latest</Button>}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                    {customDiff ? "Comparing" : "Latest scan compared with the one before it:"} {base ? runLabel(base) : "earlier scan"} → {target ? runLabel(target) : "later scan"}
                  </Typography>
                  <DiffColumns diff={diff} />
                </>
              )}
            </Paper>
          </Box>
        )}
      </Stack>
    </Box>
  );
}

function DiffColumns({ diff }: { diff: ScanDiff }) {
  const added = diff.new_hosts || [];
  const missing = diff.missing_hosts || [];
  const changed = diff.changed_hosts || [];
  return (
    <Box sx={{ mt: 2, display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" } }}>
      <DiffList title="Joined" tone="info" hosts={added} empty="No new devices." />
      <DiffList title="Left" tone="error" hosts={missing} empty="Nothing went missing." />
      <Box component="section">
        <DiffHeading title="Changed" count={changed.length} tone="warning" />
        {changed.length === 0 && <Typography variant="body2" color="text.secondary">No devices changed.</Typography>}
        <Stack spacing={1}>
          {changed.map((change) => (
            <Box key={change.ip}>
              <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 600 }}>
                {change.ip}
              </Typography>
              <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap", mt: 0.25 }}>
                {changedFields(change).map((field) => (
                  <Chip key={field} label={field} variant="outlined" sx={{ height: 20 }} />
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

function changedFields(change: HostChange) {
  return [
    change.hostname_changed && "Hostname",
    change.mac_changed && "MAC address",
    change.vendor_changed && "Vendor",
    change.ports_changed && "Open ports",
    change.device_type_changed && "Type",
  ].filter(Boolean) as string[];
}

function DiffHeading({ title, count, tone }: { title: string; count: number; tone: "info" | "error" | "warning" }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
      <Typography variant="h3">{title}</Typography>
      <Chip label={count} color={count ? tone : "default"} variant={count ? "filled" : "outlined"} sx={{ height: 20 }} />
    </Stack>
  );
}

function DiffList({ title, hosts, empty, tone }: { title: string; hosts: HostObservation[]; empty: string; tone: "info" | "error" }) {
  return (
    <Box component="section">
      <DiffHeading title={title} count={hosts.length} tone={tone} />
      {hosts.length === 0 && <Typography variant="body2" color="text.secondary">{empty}</Typography>}
      <Stack spacing={1}>
        {hosts.map((host) => (
          <Box key={host.ip}>
            <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 600 }}>
              {host.ip}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {hostLabel(host) === host.ip ? "No name recorded" : hostLabel(host)}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
