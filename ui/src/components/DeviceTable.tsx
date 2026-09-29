import { useMemo, useState, type ReactNode, type KeyboardEvent } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Typography from "@mui/material/Typography";
import CheckCircleOutlined from "@mui/icons-material/CheckCircleOutlined";
import RemoveCircleOutlineOutlined from "@mui/icons-material/RemoveCircleOutlineOutlined";
import { monoFont } from "../theme";
import {
  categoryFor,
  compareIP,
  CATEGORY_LABEL,
  formatPorts,
  formatTime,
  textCompare,
  type DeviceState,
  type HostObservation,
} from "../net";
import { useElementWidth } from "../hooks/useElementWidth";
import { CategoryLabel } from "./CategoryLabel";
import { DeviceStateChip, STATE_LABEL } from "./StatusChip";

type ColumnKey = "ip" | "device" | "state" | "status" | "type" | "ports" | "mac" | "last_seen" | "first_seen";

type Column = {
  key: ColumnKey;
  label: string;
  // Lower priority numbers stay visible longest as the table narrows.
  priority: number;
  width: number;
  render: (host: HostObservation, state: DeviceState) => ReactNode;
  compare: (a: HostObservation, b: HostObservation, states: Record<string, DeviceState>) => number;
};

const mono = { fontFamily: monoFont, fontSize: 12.5 };

const COLUMNS: Record<ColumnKey, Column> = {
  ip: {
    key: "ip",
    label: "IP address",
    priority: 0,
    width: 130,
    render: (host) => <Box sx={mono}>{host.ip}</Box>,
    compare: (a, b) => compareIP(a.ip, b.ip),
  },
  device: {
    key: "device",
    label: "Device",
    priority: 0,
    width: 210,
    render: (host) => (
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }} title={host.hostname || undefined}>
          {host.hostname || (host.alive ? "No hostname" : "Not answering")}
        </Typography>
        {host.vendor && (
          <Typography variant="caption" color="text.secondary" noWrap component="div" title={host.vendor}>
            {host.vendor}
          </Typography>
        )}
      </Box>
    ),
    compare: (a, b) => textCompare(a.hostname || "", b.hostname || "") || textCompare(a.vendor || "", b.vendor || ""),
  },
  state: {
    key: "state",
    label: "Change",
    priority: 1,
    width: 130,
    render: (_, state) =>
      state === "stable" ? (
        <Typography variant="body2" color="text.secondary" aria-label="No change">
          —
        </Typography>
      ) : (
        <DeviceStateChip state={state} />
      ),
    compare: (a, b, states) => textCompare(STATE_LABEL[states[a.ip] || "stable"], STATE_LABEL[states[b.ip] || "stable"]),
  },
  status: {
    key: "status",
    label: "Status",
    priority: 1,
    width: 100,
    render: (host) =>
      host.alive ? (
        <Chip icon={<CheckCircleOutlined />} label="Up" color="success" variant="outlined" sx={{ height: 22 }} />
      ) : (
        <Chip icon={<RemoveCircleOutlineOutlined />} label="Down" variant="outlined" sx={{ height: 22 }} />
      ),
    compare: (a, b) => Number(b.alive) - Number(a.alive),
  },
  type: {
    key: "type",
    label: "Type",
    priority: 1,
    width: 170,
    render: (host) => <CategoryLabel category={categoryFor(host)} dense />,
    compare: (a, b) => textCompare(CATEGORY_LABEL[categoryFor(a)], CATEGORY_LABEL[categoryFor(b)]),
  },
  ports: {
    key: "ports",
    label: "Open ports",
    priority: 2,
    width: 150,
    render: (host) => {
      const shown = host.open_ports.slice(0, 4).map((port) => port.port).join(" ");
      const more = host.open_ports.length - 4;
      return (
        <Box sx={{ ...mono, whiteSpace: "nowrap" }} title={formatPorts(host.open_ports) || undefined}>
          {shown || <Box component="span" sx={{ color: "text.secondary", fontFamily: "inherit" }}>None</Box>}
          {more > 0 && <Box component="span" sx={{ color: "text.secondary" }}> +{more}</Box>}
        </Box>
      );
    },
    compare: (a, b) => b.open_ports.length - a.open_ports.length,
  },
  mac: {
    key: "mac",
    label: "MAC address",
    priority: 4,
    width: 160,
    render: (host) => <Box sx={{ ...mono, color: host.mac_address ? "text.primary" : "text.secondary" }}>{host.mac_address || "Unknown"}</Box>,
    compare: (a, b) => textCompare(a.mac_address || "", b.mac_address || ""),
  },
  last_seen: {
    key: "last_seen",
    label: "Last seen",
    priority: 3,
    width: 120,
    render: (host) => <Box sx={{ whiteSpace: "nowrap" }}>{formatTime(host.last_updated)}</Box>,
    compare: (a, b) => Date.parse(a.last_updated || "") - Date.parse(b.last_updated || ""),
  },
  first_seen: {
    key: "first_seen",
    label: "First seen",
    priority: 5,
    width: 120,
    render: (host) => <Box sx={{ whiteSpace: "nowrap" }}>{formatTime(host.first_seen)}</Box>,
    compare: (a, b) => Date.parse(a.first_seen || "") - Date.parse(b.first_seen || ""),
  },
};

export const DESKTOP_COLUMNS: ColumnKey[] = ["ip", "device", "state", "type", "ports", "mac", "first_seen", "last_seen"];
export const SERVER_COLUMNS: ColumnKey[] = ["ip", "device", "status", "type", "ports", "mac", "last_seen"];

// DeviceTable drops its lowest-priority columns to fit the space it has
// rather than scrolling sideways. Rows are keyboard-selectable (Enter/Space,
// arrows move between rows) and report aria-selected.
export function DeviceTable({
  hosts,
  states = {},
  columns,
  selectedIP,
  onSelect,
  empty,
  label = "Devices",
}: {
  hosts: HostObservation[];
  states?: Record<string, DeviceState>;
  columns: ColumnKey[];
  selectedIP: string;
  onSelect: (ip: string) => void;
  empty: ReactNode;
  label?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [sortKey, setSortKey] = useState<ColumnKey>("ip");
  const [sortAsc, setSortAsc] = useState(true);

  const visibleColumns = useMemo(() => {
    const budget = (width || 1200) - 16;
    const byPriority = [...columns].sort((a, b) => COLUMNS[a].priority - COLUMNS[b].priority);
    const kept = new Set<ColumnKey>();
    let used = 0;
    for (const key of byPriority) {
      if (kept.size >= 2 && used + COLUMNS[key].width > budget) continue;
      kept.add(key);
      used += COLUMNS[key].width;
    }
    return columns.filter((key) => kept.has(key)).map((key) => COLUMNS[key]);
  }, [columns, width]);

  const sorted = useMemo(() => {
    const column = COLUMNS[sortKey];
    return [...hosts].sort((a, b) => {
      const order = column.compare(a, b, states) || compareIP(a.ip, b.ip);
      return sortAsc ? order : -order;
    });
  }, [hosts, states, sortKey, sortAsc]);

  function toggleSort(key: ColumnKey) {
    if (key === sortKey) setSortAsc((asc) => !asc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function onRowKey(event: KeyboardEvent<HTMLTableRowElement>, ip: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(ip === selectedIP ? "" : ip);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const sibling = event.key === "ArrowDown" ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
      (sibling as HTMLElement | null)?.focus();
    } else if (event.key === "Escape" && selectedIP) {
      onSelect("");
    }
  }

  return (
    <Box ref={ref} sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <Table stickyHeader aria-label={label} sx={{ tableLayout: "fixed", minWidth: 0 }}>
        <colgroup>
          {visibleColumns.map((column) => (
            <col key={column.key} style={{ width: column.width }} />
          ))}
        </colgroup>
        <TableHead>
          <TableRow>
            {visibleColumns.map((column) => (
              <TableCell key={column.key} sortDirection={sortKey === column.key ? (sortAsc ? "asc" : "desc") : false} sx={{ bgcolor: "background.paper" }}>
                <TableSortLabel active={sortKey === column.key} direction={sortKey === column.key && !sortAsc ? "desc" : "asc"} onClick={() => toggleSort(column.key)}>
                  {column.label}
                </TableSortLabel>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((host) => {
            const selected = host.ip === selectedIP;
            const state = states[host.ip] || "stable";
            return (
              <TableRow
                key={host.ip}
                hover
                selected={selected}
                tabIndex={0}
                aria-selected={selected}
                data-ip={host.ip}
                onClick={() => onSelect(selected ? "" : host.ip)}
                onKeyDown={(event) => onRowKey(event, host.ip)}
                sx={{
                  cursor: "pointer",
                  opacity: host.alive || host.open_ports.length ? 1 : 0.7,
                  "&:focus-visible": { outline: 2, outlineStyle: "solid", outlineColor: "primary.main", outlineOffset: -2 },
                  "& td": { overflow: "hidden", textOverflow: "ellipsis" },
                }}
              >
                {visibleColumns.map((column) => (
                  <TableCell key={column.key}>{column.render(host, state)}</TableCell>
                ))}
              </TableRow>
            );
          })}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={visibleColumns.length} sx={{ borderBottom: 0 }}>
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Box>
  );
}
