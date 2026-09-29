import { useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import FolderOpenOutlined from "@mui/icons-material/FolderOpenOutlined";
import SaveOutlined from "@mui/icons-material/SaveOutlined";
import TableViewOutlined from "@mui/icons-material/TableViewOutlined";
import TuneOutlined from "@mui/icons-material/TuneOutlined";
import ExpandMoreOutlined from "@mui/icons-material/ExpandMoreOutlined";
import RadarOutlined from "@mui/icons-material/RadarOutlined";
import StopCircleOutlined from "@mui/icons-material/StopCircleOutlined";
import LoopOutlined from "@mui/icons-material/LoopOutlined";
import { useToast } from "@netviz/ui";
import { MONITOR_INTERVALS } from "../../settings";
import type { ScanState } from "../../state/useScan";

// ScanToolbar has exactly one primary action. It names what it will do
// ("Scan 192.168.1.0/24") and turns into "Cancel scan" while one runs.
// Occasional actions live under More.
export function ScanToolbar({ scan, onOpenPorts }: { scan: ScanState; onOpenPorts: () => void }) {
  const toast = useToast();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const cidr = scan.cidr.trim();
  const blocked = scan.blocked;

  async function file(action: "open" | "save" | "csv") {
    setMenuAnchor(null);
    const done = await scan.fileAction(action);
    if (done && action !== "open") toast(action === "save" ? "Scan saved" : "CSV exported");
  }

  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "flex-start", flexWrap: "wrap" }}>
      <Autocomplete
        freeSolo
        disableClearable
        options={scan.detected}
        value={scan.cidr}
        inputValue={scan.cidr}
        onInputChange={(_, value) => scan.setCidr(value)}
        disabled={scan.scanning}
        sx={{ width: 220 }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Network range"
            error={Boolean(cidr) && !scan.cidrValid}
            helperText={cidr && !scan.cidrValid ? "Use a range like 192.168.1.0/24" : undefined}
            slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, spellCheck: false } }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !scan.scanning && !blocked) void scan.startScan(false);
            }}
          />
        )}
      />
      {scan.scanning && !scan.monitoring ? (
        <Button variant="contained" color="inherit" startIcon={<StopCircleOutlined />} onClick={() => void scan.cancel()} sx={{ height: 40, minWidth: 170 }}>
          Cancel scan
        </Button>
      ) : (
        <Tooltip title={blocked}>
          <span>
            <Button
              variant="contained"
              startIcon={<RadarOutlined />}
              onClick={() => void scan.startScan(false)}
              disabled={Boolean(blocked) || scan.monitoring}
              sx={{ height: 40, minWidth: 170 }}
            >
              {scan.cidrValid ? `Scan ${cidr}` : "Scan"}
            </Button>
          </span>
        </Tooltip>
      )}
      <Button
        variant={scan.monitoring ? "contained" : "outlined"}
        color={scan.monitoring ? "success" : "primary"}
        startIcon={<LoopOutlined />}
        onClick={() => void scan.toggleMonitor()}
        aria-pressed={scan.monitoring}
        disabled={!scan.monitoring && Boolean(blocked)}
        sx={{ height: 40 }}
      >
        {scan.monitoring ? "Stop monitoring" : "Monitor"}
      </Button>
      <TextField
        select
        label="Every"
        value={scan.monitorMs}
        onChange={(event) => scan.setMonitorMs(Number(event.target.value))}
        sx={{ width: 130 }}
      >
        {MONITOR_INTERVALS.map((interval) => (
          <MenuItem key={interval.ms} value={interval.ms}>
            {interval.label}
          </MenuItem>
        ))}
      </TextField>
      <Button
        variant="text"
        endIcon={<ExpandMoreOutlined />}
        onClick={(event) => setMenuAnchor(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={Boolean(menuAnchor)}
        sx={{ height: 40 }}
      >
        More
      </Button>
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => void file("open")}>
          <ListItemIcon><FolderOpenOutlined fontSize="small" /></ListItemIcon>
          <ListItemText primary="Open a saved scan…" secondary="Ctrl+O" />
        </MenuItem>
        {scan.rows.length > 0 && (
          <MenuItem onClick={() => void file("save")}>
            <ListItemIcon><SaveOutlined fontSize="small" /></ListItemIcon>
            <ListItemText primary="Save this scan…" secondary="Ctrl+S" />
          </MenuItem>
        )}
        {scan.rows.length > 0 && (
          <MenuItem onClick={() => void file("csv")}>
            <ListItemIcon><TableViewOutlined fontSize="small" /></ListItemIcon>
            <ListItemText primary="Export as CSV…" secondary="Ctrl+Shift+S" />
          </MenuItem>
        )}
        <Divider />
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onOpenPorts();
          }}
        >
          <ListItemIcon><TuneOutlined fontSize="small" /></ListItemIcon>
          <ListItemText primary="Scan ports…" secondary={scan.portsCustomized ? `${scan.scanPorts.length} chosen` : "Defaults"} />
        </MenuItem>
        <MenuItem onClick={() => scan.setShowUnresponsive((value) => !value)} role="menuitemcheckbox" aria-checked={scan.showUnresponsive}>
          <ListItemIcon>
            <Checkbox edge="start" size="small" checked={scan.showUnresponsive} tabIndex={-1} disableRipple sx={{ p: 0 }} />
          </ListItemIcon>
          <ListItemText primary="Show addresses that didn't answer" />
        </MenuItem>
      </Menu>
    </Stack>
  );
}
