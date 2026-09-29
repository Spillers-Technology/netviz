import Box from "@mui/material/Box";
import { CATEGORY_COLORS } from "../categories";
import { CATEGORY_LABEL, hostLabel, type DeviceState } from "../net";
import { useResolvedMode } from "../hooks/useResolvedMode";
import type { TopologyLayout } from "./layout";

const STATE_STROKE = {
  light: { new: "#0969da", online: "#1a7f37", offline: "#cf222e", changed: "#9a6700" },
  dark: { new: "#67dcff", online: "#4ade80", offline: "#f87171", changed: "#fbbf24" },
} as const;

// FlatTopology draws the same layout from directly above as SVG. It is the
// fallback when WebGL isn't available, and a choice for anyone who prefers a
// flat map. Every device is a keyboard-reachable button.
export function FlatTopology({
  layout,
  states,
  selectedIP,
  matches,
  onSelect,
}: {
  layout: TopologyLayout;
  states: Record<string, DeviceState>;
  selectedIP: string;
  matches: Set<string> | null;
  onSelect: (ip: string) => void;
}) {
  const mode = useResolvedMode();
  const pad = 1.6;
  const extent = layout.extent + pad;
  const scale = 40;
  const size = extent * 2 * scale;
  const px = (value: number) => (value + extent) * scale;

  return (
    <Box
      component="svg"
      viewBox={`0 0 ${size} ${size}`}
      role="group"
      aria-label="Flat network map"
      sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      onClick={() => onSelect("")}
    >
      <circle cx={px(0)} cy={px(0)} r={layout.ringRadius * scale} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeDasharray="4 6" />
      {layout.clusters.map((cluster) => (
        <g key={cluster.category}>
          <line x1={px(0)} y1={px(0)} x2={px(cluster.x)} y2={px(cluster.z)} stroke={CATEGORY_COLORS[mode][cluster.category]} strokeOpacity={0.45} strokeWidth={2} />
          <circle cx={px(cluster.x)} cy={px(cluster.z)} r={cluster.radius * scale} fill={CATEGORY_COLORS[mode][cluster.category]} fillOpacity={0.08} />
          <text
            x={px(cluster.x + Math.cos(cluster.angle) * (cluster.radius + 0.9))}
            y={px(cluster.z + Math.sin(cluster.angle) * (cluster.radius + 0.9))}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={14}
            fontWeight={600}
            fill="currentColor"
          >
            {CATEGORY_LABEL[cluster.category]} · {cluster.count}
          </text>
        </g>
      ))}
      {layout.nodes.map((node) => {
        if (node.gateway) return null;
        const cluster = layout.clusters.find((candidate) => candidate.category === node.category);
        if (!cluster) return null;
        return (
          <line
            key={`edge-${node.host.ip}`}
            x1={px(cluster.x)}
            y1={px(cluster.z)}
            x2={px(node.x)}
            y2={px(node.z)}
            stroke={CATEGORY_COLORS[mode][node.category]}
            strokeOpacity={0.25}
          />
        );
      })}
      {layout.nodes.map((node) => {
        const ip = node.host.ip;
        const active = node.host.alive || node.host.open_ports.length > 0;
        const state = states[ip];
        const dimmed = matches && !matches.has(ip);
        const r = node.size * scale * (ip === selectedIP ? 1.3 : 1);
        return (
          <g
            key={ip}
            role="button"
            tabIndex={0}
            aria-label={`${hostLabel(node.host)}, ${ip}, ${CATEGORY_LABEL[node.category]}${node.gateway ? ", gateway" : ""}`}
            aria-pressed={ip === selectedIP}
            style={{ cursor: "pointer", opacity: dimmed ? 0.25 : 1 }}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(ip === selectedIP ? "" : ip);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(ip === selectedIP ? "" : ip);
              }
            }}
          >
            <title>{`${hostLabel(node.host)} (${ip})`}</title>
            {state && state !== "stable" && (
              <circle cx={px(node.x)} cy={px(node.z)} r={r + 6} fill="none" stroke={STATE_STROKE[mode][state]} strokeWidth={3} />
            )}
            {ip === selectedIP && <circle cx={px(node.x)} cy={px(node.z)} r={r + 11} fill="none" stroke="currentColor" strokeWidth={2} />}
            <circle cx={px(node.x)} cy={px(node.z)} r={r} fill={CATEGORY_COLORS[mode][active ? node.category : "unknown"]} />
          </g>
        );
      })}
    </Box>
  );
}
