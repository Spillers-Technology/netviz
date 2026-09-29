import Chip from "@mui/material/Chip";
import CheckCircleOutlined from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlineOutlined from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import ReportProblemOutlined from "@mui/icons-material/ReportProblemOutlined";
import RadioButtonUncheckedOutlined from "@mui/icons-material/RadioButtonUncheckedOutlined";
import SyncOutlined from "@mui/icons-material/SyncOutlined";
import type { DeviceState } from "../net";

export type Tone = "success" | "warning" | "error" | "info" | "neutral" | "busy";

const ICONS = {
  success: CheckCircleOutlined,
  warning: ReportProblemOutlined,
  error: ErrorOutlineOutlined,
  info: InfoOutlined,
  neutral: RadioButtonUncheckedOutlined,
  busy: SyncOutlined,
};

// StatusChip never carries meaning by color alone: every tone has its icon
// and the label says the state in words.
export function StatusChip({ tone, label, title }: { tone: Tone; label: string; title?: string }) {
  const Icon = ICONS[tone];
  const color = tone === "neutral" ? "default" : tone === "busy" ? "info" : tone;
  return (
    <Chip
      icon={<Icon sx={tone === "busy" ? { animation: "netviz-spin 1.4s linear infinite", "@keyframes netviz-spin": { to: { transform: "rotate(360deg)" } } } : undefined} />}
      label={label}
      color={color}
      variant="outlined"
      title={title}
      role="status"
      sx={{ fontWeight: 600, bgcolor: "background.paper" }}
    />
  );
}

const STATE_TONE: Record<DeviceState, Tone> = {
  new: "info",
  online: "success",
  offline: "error",
  changed: "warning",
  stable: "neutral",
};

const STATE_LABEL: Record<DeviceState, string> = {
  new: "New",
  online: "Back online",
  offline: "Offline",
  changed: "Changed",
  stable: "Stable",
};

export function DeviceStateChip({ state }: { state: DeviceState }) {
  const Icon = ICONS[STATE_TONE[state]];
  const tone = STATE_TONE[state];
  return (
    <Chip
      icon={<Icon />}
      label={STATE_LABEL[state]}
      color={tone === "neutral" || tone === "busy" ? "default" : tone}
      variant={state === "stable" ? "outlined" : "filled"}
      sx={{ fontWeight: 600, height: 22, "& .MuiChip-icon": { fontSize: 16 } }}
    />
  );
}

export { STATE_LABEL, STATE_TONE };
