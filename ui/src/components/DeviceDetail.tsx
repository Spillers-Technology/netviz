import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseOutlined from "@mui/icons-material/CloseOutlined";
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import { monoFont } from "../theme";
import { categoryFor, deviceSummary, normalizeHost, type DeviceState, type HostHistoryEntry, type HostObservation } from "../net";
import { friendlyError, type FriendlyError } from "../errors";
import { useToast } from "../hooks/useToast";
import { CategoryLabel } from "./CategoryLabel";
import { DeviceStateChip } from "./StatusChip";
import { ErrorNotice } from "./ErrorNotice";

type HistoryLoad =
  | { status: "loading" }
  | { status: "ready"; entries: HostHistoryEntry[] }
  | { status: "error"; error: FriendlyError };

// DeviceDetail is the one inspector every network view opens: identity, open
// ports, the device's own history when a loader is given, and "Copy details"
// for pasting into a ticket.
export function DeviceDetail({
  host,
  state = "stable",
  loadHistory,
  onClose,
}: {
  host: HostObservation;
  state?: DeviceState;
  loadHistory?: (ip: string) => Promise<HostHistoryEntry[]>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [history, setHistory] = useState<HistoryLoad>({ status: "loading" });

  useEffect(() => {
    if (!loadHistory) return;
    let cancelled = false;
    setHistory({ status: "loading" });
    loadHistory(host.ip)
      .then((entries) => {
        if (!cancelled) setHistory({ status: "ready", entries: (entries || []).map((entry) => ({ ...entry, host: normalizeHost(entry.host) })) });
      })
      .catch((err) => {
        if (!cancelled) setHistory({ status: "error", error: friendlyError(err, "Loading this device's history") });
      });
    return () => {
      cancelled = true;
    };
  }, [host.ip, loadHistory]);

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(deviceSummary(host, state));
      toast("Device details copied");
    } catch {
      toast("Couldn't reach the clipboard", "warning");
    }
  }

  const facts: [string, string | undefined, boolean?][] = [
    ["IP address", host.ip, true],
    ["Hostname", host.hostname],
    ["MAC address", host.mac_address, true],
    ["Vendor", host.vendor],
  ];

  return (
    <Box component="aside" aria-label="Device details" sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", p: 2, pb: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h2" component="h2" noWrap title={host.hostname || host.ip}>
            {host.hostname || host.ip}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", mt: 1 }} useFlexGap>
            <CategoryLabel category={categoryFor(host)} dense />
            <DeviceStateChip state={state} />
          </Stack>
        </Box>
        <Tooltip title="Close details">
          <IconButton onClick={onClose} aria-label="Close details">
            <CloseOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Divider />
      <Box sx={{ p: 2, overflow: "auto", flex: 1, minHeight: 0 }}>
        <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 2, rowGap: 0.75 }}>
          {facts.map(([label, value, isMono]) => (
            <Box key={label} sx={{ display: "contents" }}>
              <Typography component="dt" variant="body2" color="text.secondary">
                {label}
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, minWidth: 0, overflowWrap: "anywhere", fontFamily: value && isMono ? monoFont : undefined, color: value ? "text.primary" : "text.secondary" }}>
                {value || "Unknown"}
              </Typography>
            </Box>
          ))}
        </Box>

        <Typography variant="h3" component="h3" sx={{ mt: 2.5, mb: 1 }}>
          Open ports
        </Typography>
        {host.open_ports.length > 0 ? (
          <Stack spacing={0.5}>
            {host.open_ports.map((port) => (
              <Stack key={port.port} direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
                <Box sx={{ fontFamily: monoFont, fontWeight: 700, minWidth: 48 }}>{port.port}</Box>
                <Typography variant="body2" color="text.secondary">
                  {port.service}
                </Typography>
              </Stack>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            None of the scanned ports answered.
          </Typography>
        )}

        {loadHistory && (
          <>
            <Typography variant="h3" component="h3" sx={{ mt: 2.5, mb: 1 }}>
              History
            </Typography>
            {history.status === "loading" && <LinearProgress aria-label="Loading device history" />}
            {history.status === "error" && <ErrorNotice error={history.error} />}
            {history.status === "ready" && history.entries.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                No saved history for this device yet. It builds up as you scan.
              </Typography>
            )}
            {history.status === "ready" && history.entries.length > 0 && (
              <>
                <Stack spacing={0.75}>
                  {history.entries.map((entry) => (
                    <Stack key={entry.run_id} direction="row" spacing={1.5}>
                      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 104, flexShrink: 0, whiteSpace: "nowrap" }}>
                        {formatHistoryRange(entry)}
                      </Typography>
                      <Typography variant="body2" sx={{ fontFamily: monoFont, fontSize: 12.5, minWidth: 0, overflowWrap: "anywhere" }}>
                        {summarizeObservation(entry.host)}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                  Monitor cycles with no change are merged; each row is a state NetViz observed.
                </Typography>
              </>
            )}
          </>
        )}
      </Box>
      <Divider />
      <Box sx={{ p: 1.5 }}>
        <Button startIcon={<ContentCopyOutlined />} onClick={copyDetails}>
          Copy details
        </Button>
      </Box>
    </Box>
  );
}

function formatHistoryRange(entry: HostHistoryEntry) {
  const start = new Date(entry.started_at);
  const end = entry.ended_at ? new Date(entry.ended_at) : null;
  const day = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const startTime = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!end || end.getTime() - start.getTime() < 90_000) return `${day} ${startTime}`;
  const endTime = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} ${startTime}–${endTime}`;
}

function summarizeObservation(host: HostObservation) {
  if (!host.alive && host.open_ports.length === 0) return "Down";
  const ports = host.open_ports.map((port) => port.port).join(", ");
  return ports ? `Up · ${ports}` : "Up";
}
