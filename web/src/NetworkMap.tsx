import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Device } from "./types";

// Categories and colors are shared with the desktop hierarchy view. The
// palette is CVD-validated all-pairs (worst deltaE 16.0 under protanopia and
// deuteranopia, >=3:1 on white); "unknown" is deliberately low-chroma so
// unidentified devices recede. Identity never rides on color alone: the
// legend, labels, and tooltip all carry it too.
export const CATEGORY_ORDER = [
  "firewall/network",
  "windows/smb",
  "linux/iot",
  "apple",
  "printer",
  "camera/media",
  "web appliance",
  "unknown",
] as const;

export const CATEGORY_COLORS: Record<string, string> = {
  "firewall/network": "#0b5cab",
  "windows/smb": "#2f7fe0",
  "linux/iot": "#107040",
  apple: "#6d3bd1",
  printer: "#b45309",
  "camera/media": "#c02878",
  "web appliance": "#0891b2",
  unknown: "#64748b",
};

export function categoryFor(device: Device): string {
  if (!device.alive && device.open_ports.length === 0) return "unknown";
  if (device.open_ports.some((port) => port.port === 53) || device.device_type === "network_device") return "firewall/network";
  if (device.device_type === "windows_or_smb" || device.device_type === "windows_rdp") return "windows/smb";
  if (device.device_type === "ssh_device" || device.device_type === "linux_or_iot" || device.device_type === "iot_device") return "linux/iot";
  if (device.device_type === "apple_device") return "apple";
  if (device.device_type === "printer") return "printer";
  if (device.device_type === "camera_or_rtsp" || device.device_type === "plex") return "camera/media";
  if (device.device_type === "web_device") return "web appliance";
  return "unknown";
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const HUB_RADIUS = 30;
const MIN_SCALE = 0.35;
const MAX_SCALE = 4;

type MapNode = {
  device: Device;
  category: string;
  // Layout target in world coordinates; x/y animate toward it.
  tx: number;
  ty: number;
  x: number;
  y: number;
  r: number;
  born: number;
  phase: number;
  labelRank: number;
};

type Cluster = {
  category: string;
  cx: number;
  cy: number;
  radius: number;
  count: number;
};

type View = { scale: number; x: number; y: number };

export function NetworkMap({ devices, cidr }: { devices: Device[]; cidr: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Map<string, MapNode>>(new Map());
  const clustersRef = useRef<Cluster[]>([]);
  const viewRef = useRef<View>({ scale: 1, x: 0, y: 0 });
  const sizeRef = useRef({ width: 0, height: 0 });
  const hoverRef = useRef<string>("");
  const focusRef = useRef<string>("");
  const dragRef = useRef<{ startX: number; startY: number; viewX: number; viewY: number; moved: boolean } | null>(null);
  const fittedRef = useRef(false);
  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  const [selectedIP, setSelectedIP] = useState("");
  const [focusCategory, setFocusCategory] = useState("");
  const [tooltip, setTooltip] = useState<{ ip: string; x: number; y: number } | null>(null);

  const selectedRef = useRef(selectedIP);
  selectedRef.current = selectedIP;
  focusRef.current = focusCategory;

  const counts = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const device of devices) {
      const category = categoryFor(device);
      byCategory.set(category, (byCategory.get(category) || 0) + 1);
    }
    return byCategory;
  }, [devices]);

  const selected = devices.find((device) => device.ip === selectedIP);

  // Reconcile nodes with incoming devices: existing nodes keep their animated
  // position and glide to new targets; new nodes pop in from their cluster
  // center; departed nodes are dropped.
  useEffect(() => {
    const nodes = nodesRef.current;
    const seen = new Set<string>();
    const grouped = new Map<string, Device[]>();
    for (const device of devices) {
      const category = categoryFor(device);
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category)!.push(device);
    }

    const clusters = layoutClusters(grouped);
    clustersRef.current = clusters;

    const labelOrder = [...devices]
      .sort((a, b) => b.open_ports.length - a.open_ports.length)
      .map((device) => device.ip);
    const labelRank = new Map(labelOrder.map((ip, index) => [ip, index]));

    for (const cluster of clusters) {
      const members = grouped.get(cluster.category)!;
      members.sort((a, b) => b.open_ports.length - a.open_ports.length || compareIP(a.ip, b.ip));
      members.forEach((device, index) => {
        const spot = phyllotaxis(index, cluster);
        seen.add(device.ip);
        const existing = nodes.get(device.ip);
        if (existing) {
          existing.device = device;
          existing.category = cluster.category;
          existing.tx = spot.x;
          existing.ty = spot.y;
          existing.r = nodeRadius(device);
          existing.labelRank = labelRank.get(device.ip) ?? 99;
        } else {
          nodes.set(device.ip, {
            device,
            category: cluster.category,
            tx: spot.x,
            ty: spot.y,
            x: cluster.cx,
            y: cluster.cy,
            r: nodeRadius(device),
            born: performance.now(),
            phase: Math.random() * Math.PI * 2,
            labelRank: labelRank.get(device.ip) ?? 99,
          });
        }
      });
    }

    for (const ip of [...nodes.keys()]) {
      if (!seen.has(ip)) nodes.delete(ip);
    }

    if (!fittedRef.current && devices.length > 0) {
      fitView();
      fittedRef.current = true;
    }
  }, [devices]);

  function fitView() {
    const { width, height } = sizeRef.current;
    if (width === 0) return;
    let extent = HUB_RADIUS + 80;
    for (const cluster of clustersRef.current) {
      extent = Math.max(extent, Math.hypot(cluster.cx, cluster.cy) + cluster.radius + 46);
    }
    const scale = clamp(Math.min(width, height) / (2 * extent), MIN_SCALE, 1.25);
    viewRef.current = { scale, x: width / 2, y: height / 2 };
  }

  // Canvas sizing, input handlers, and the render loop live outside React
  // state so frames never re-render the component tree.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const glowSprites = new Map<string, HTMLCanvasElement>();
    for (const [category, color] of Object.entries(CATEGORY_COLORS)) {
      glowSprites.set(category, makeGlowSprite(color));
    }

    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const hadSize = sizeRef.current.width > 0;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      sizeRef.current = { width: rect.width, height: rect.height };
      if (!hadSize) fitView();
    });
    observer.observe(container);

    function toWorld(clientX: number, clientY: number) {
      const rect = canvas!.getBoundingClientRect();
      const view = viewRef.current;
      return {
        x: (clientX - rect.left - view.x) / view.scale,
        y: (clientY - rect.top - view.y) / view.scale,
      };
    }

    function nodeAt(clientX: number, clientY: number): MapNode | null {
      const point = toWorld(clientX, clientY);
      const slack = 5 / viewRef.current.scale;
      let best: MapNode | null = null;
      let bestDist = Infinity;
      for (const node of nodesRef.current.values()) {
        const dist = Math.hypot(node.x - point.x, node.y - point.y);
        if (dist <= node.r + slack && dist < bestDist) {
          best = node;
          bestDist = dist;
        }
      }
      return best;
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const view = viewRef.current;
      const rect = canvas!.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
      const applied = next / view.scale;
      view.x = px - (px - view.x) * applied;
      view.y = py - (py - view.y) * applied;
      view.scale = next;
    }

    function onPointerDown(event: PointerEvent) {
      canvas!.setPointerCapture(event.pointerId);
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        viewX: viewRef.current.x,
        viewY: viewRef.current.y,
        moved: false,
      };
    }

    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (drag) {
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (Math.hypot(dx, dy) > 4) drag.moved = true;
        if (drag.moved) {
          viewRef.current.x = drag.viewX + dx;
          viewRef.current.y = drag.viewY + dy;
          hoverRef.current = "";
          setTooltip(null);
          return;
        }
      }
      const node = nodeAt(event.clientX, event.clientY);
      hoverRef.current = node ? node.device.ip : "";
      canvas!.style.cursor = node ? "pointer" : dragRef.current?.moved ? "grabbing" : "grab";
      if (node) {
        const rect = container!.getBoundingClientRect();
        setTooltip({ ip: node.device.ip, x: event.clientX - rect.left, y: event.clientY - rect.top });
      } else {
        setTooltip(null);
      }
    }

    function onPointerUp(event: PointerEvent) {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag?.moved) return;
      const node = nodeAt(event.clientX, event.clientY);
      setSelectedIP(node && node.device.ip !== selectedRef.current ? node.device.ip : "");
    }

    function onDoubleClick() {
      fitView();
    }

    function onLeave() {
      hoverRef.current = "";
      setTooltip(null);
    }

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("dblclick", onDoubleClick);

    let raf = 0;
    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      const view = viewRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const backdrop = ctx.createLinearGradient(0, 0, 0, height);
      backdrop.addColorStop(0, "#fdfefe");
      backdrop.addColorStop(1, "#f3f6fa");
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, width, height);

      ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);

      const focus = focusRef.current;
      const hoverIP = hoverRef.current;
      const selectedNow = selectedRef.current;

      // Guide ring through the cluster centers.
      const clusters = clustersRef.current;
      if (clusters.length > 0) {
        const ring = clusters.reduce((sum, cluster) => sum + Math.hypot(cluster.cx, cluster.cy), 0) / clusters.length;
        ctx.beginPath();
        ctx.arc(0, 0, ring, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(110, 127, 147, 0.16)";
        ctx.lineWidth = 1 / view.scale;
        ctx.setLineDash([4 / view.scale, 6 / view.scale]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Animate positions and pop-in.
      for (const node of nodesRef.current.values()) {
        if (reducedMotion) {
          node.x = node.tx;
          node.y = node.ty;
        } else {
          node.x += (node.tx - node.x) * 0.08;
          node.y += (node.ty - node.y) * 0.08;
        }
      }

      // Edges: quadratic curves from the hub, bent through the cluster
      // center for an organic bundled look.
      for (const node of nodesRef.current.values()) {
        const cluster = clusters.find((c) => c.category === node.category);
        if (!cluster) continue;
        const emphasized = node.device.ip === hoverIP || node.device.ip === selectedNow;
        const dimmed = focus && node.category !== focus;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(cluster.cx * 0.55, cluster.cy * 0.55, node.x, node.y);
        ctx.strokeStyle = CATEGORY_COLORS[node.category];
        ctx.globalAlpha = emphasized ? 0.75 : dimmed ? 0.04 : node.device.alive ? 0.16 : 0.07;
        ctx.lineWidth = (emphasized ? 1.8 : 1) / view.scale;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Glow pass (sprite-based; shadows are too slow for hundreds of nodes).
      if (!reducedMotion) {
        for (const node of nodesRef.current.values()) {
          if (!node.device.alive || node.device.open_ports.length === 0) continue;
          if (focus && node.category !== focus) continue;
          const sprite = glowSprites.get(node.category);
          if (!sprite) continue;
          const pulse = 1 + 0.16 * Math.sin(time / 900 + node.phase);
          const size = node.r * 5.4 * pulse;
          ctx.globalAlpha = 0.32;
          ctx.drawImage(sprite, node.x - size / 2, node.y - size / 2, size, size);
        }
        ctx.globalAlpha = 1;
      }

      // Nodes.
      for (const node of nodesRef.current.values()) {
        const dimmed = focus && node.category !== focus;
        const color = CATEGORY_COLORS[node.category];
        const age = (time - node.born) / 420;
        const pop = reducedMotion ? 1 : age >= 1 ? 1 : easeOutBack(Math.max(0, age));
        const radius = node.r * pop;
        ctx.globalAlpha = dimmed ? 0.15 : 1;

        if (node.device.alive || node.device.open_ports.length > 0) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.6 / view.scale;
          ctx.stroke();
        } else {
          // Non-responsive devices are hollow rings: a shape cue, not a color one.
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = "#f3f5f8";
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5 / view.scale;
          ctx.stroke();
        }

        if (node.device.open_ports.length > 0 && radius > 6) {
          ctx.fillStyle = "#ffffff";
          ctx.font = `700 ${Math.max(8, radius * 0.9)}px "Segoe UI", system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(node.device.open_ports.length), node.x, node.y + 0.5);
        }

        const isHover = node.device.ip === hoverIP;
        const isSelected = node.device.ip === selectedNow;
        if (isSelected || isHover) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 3.5 / view.scale, 0, Math.PI * 2);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 3 / view.scale;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 5.5 / view.scale, 0, Math.PI * 2);
          ctx.strokeStyle = isSelected ? "#0b5cab" : "rgba(11, 92, 171, 0.55)";
          ctx.lineWidth = 2.4 / view.scale;
          ctx.stroke();
        }

        const showLabel =
          isHover || isSelected || (node.labelRank < 14 && node.device.open_ports.length > 0 && view.scale > 0.55);
        if (showLabel) {
          const label = node.device.hostname || node.device.ip;
          ctx.font = `${11 / view.scale}px "Segoe UI", system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.lineWidth = 3 / view.scale;
          ctx.strokeStyle = "rgba(255, 255, 255, 0.88)";
          ctx.strokeText(label, node.x, node.y + radius + 4 / view.scale);
          ctx.fillStyle = "#1a242e";
          ctx.fillText(label, node.x, node.y + radius + 4 / view.scale);
        }
      }
      ctx.globalAlpha = 1;

      // Hub last so it sits above trunk edges.
      const hubGradient = ctx.createRadialGradient(0, -HUB_RADIUS * 0.4, HUB_RADIUS * 0.2, 0, 0, HUB_RADIUS);
      hubGradient.addColorStop(0, "#1c6fbe");
      hubGradient.addColorStop(1, "#074f96");
      ctx.beginPath();
      ctx.arc(0, 0, HUB_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = hubGradient;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 / view.scale;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 12px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("LAN", 0, -2);
      ctx.font = `9px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(cidr || "", 0, 10);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDoubleClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cidr]);

  const tooltipDevice = tooltip ? devices.find((device) => device.ip === tooltip.ip) : undefined;

  return (
    <section className="mapWrap" aria-label="Network map">
      <div className="mapToolbar">
        <div className="legend" aria-label="Device type colors">
          {CATEGORY_ORDER.filter((category) => counts.has(category)).map((category) => (
            <button
              key={category}
              className={`legendChip ${focusCategory === category ? "focused" : ""}`}
              aria-pressed={focusCategory === category}
              onClick={() => setFocusCategory(focusCategory === category ? "" : category)}
            >
              <i className="legendSwatch" style={{ background: CATEGORY_COLORS[category] }} aria-hidden="true" />
              {category}
              <b>{counts.get(category)}</b>
            </button>
          ))}
        </div>
        <span className="mapHint">scroll to zoom · drag to pan · double-click to reset</span>
      </div>

      <div className="mapCanvas" ref={containerRef}>
        <canvas ref={canvasRef} role="img" aria-label="Radial map of devices grouped by type around the LAN gateway" />
        {tooltipDevice && tooltip && (
          <div
            className="mapTooltip"
            style={{
              left: Math.min(tooltip.x + 14, Math.max(0, sizeRef.current.width - 240)),
              top: Math.min(tooltip.y + 14, Math.max(0, sizeRef.current.height - 120)),
            }}
          >
            <strong>{tooltipDevice.hostname || tooltipDevice.ip}</strong>
            <span>{tooltipDevice.ip}{tooltipDevice.vendor ? ` · ${tooltipDevice.vendor}` : ""}</span>
            <span>
              {tooltipDevice.alive ? "up" : "down"} · {categoryFor(tooltipDevice)}
              {tooltipDevice.open_ports.length > 0
                ? ` · ports ${tooltipDevice.open_ports.map((port) => port.port).join(", ")}`
                : ""}
            </span>
          </div>
        )}
      </div>

      {selected && (
        <div className="mapDetail">
          <div className="mapDetailHead">
            <strong>{selected.hostname || selected.ip}</strong>
            <span className={`statusPill ${selected.alive ? "up" : "down"}`}>{selected.alive ? "up" : "down"}</span>
            <button onClick={() => setSelectedIP("")}>Close</button>
          </div>
          <dl>
            <div><dt>IP</dt><dd>{selected.ip}</dd></div>
            <div><dt>MAC</dt><dd>{selected.mac_address || "unknown"}</dd></div>
            <div><dt>Vendor</dt><dd>{selected.vendor || "unknown"}</dd></div>
            <div><dt>Type</dt><dd>{selected.device_type}</dd></div>
            <div>
              <dt>Open ports</dt>
              <dd>
                {selected.open_ports.length > 0
                  ? selected.open_ports.map((port) => `${port.port}${port.service ? "/" + port.service : ""}`).join(", ")
                  : "none"}
              </dd>
            </div>
            <div><dt>Last seen</dt><dd>{new Date(selected.last_updated).toLocaleString()}</dd></div>
          </dl>
        </div>
      )}
    </section>
  );
}

// Places category clusters on a ring wide enough that neighbors never
// overlap, each cluster sized for a phyllotaxis disc of its members.
function layoutClusters(grouped: Map<string, Device[]>): Cluster[] {
  const present = CATEGORY_ORDER.filter((category) => grouped.has(category));
  if (present.length === 0) return [];

  const sized = present.map((category) => {
    const count = grouped.get(category)!.length;
    return { category, count, radius: 16 * Math.sqrt(count) + 18 };
  });

  let ring = HUB_RADIUS + 120;
  if (sized.length > 1) {
    for (let i = 0; i < sized.length; i++) {
      const a = sized[i];
      const b = sized[(i + 1) % sized.length];
      const needed = (a.radius + b.radius + 34) / (2 * Math.sin(Math.PI / sized.length));
      ring = Math.max(ring, needed);
    }
  }
  ring = Math.max(ring, HUB_RADIUS + Math.max(...sized.map((s) => s.radius)) + 70);

  return sized.map((entry, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / sized.length;
    return {
      category: entry.category,
      cx: Math.cos(angle) * ring,
      cy: Math.sin(angle) * ring,
      radius: entry.radius,
      count: entry.count,
    };
  });
}

// Sunflower-seed packing: dense, organic, and no two nodes collide.
function phyllotaxis(index: number, cluster: Cluster) {
  const radius = 13.5 * Math.sqrt(index + 0.6);
  const angle = index * GOLDEN_ANGLE + Math.atan2(cluster.cy, cluster.cx);
  return {
    x: cluster.cx + Math.cos(angle) * radius,
    y: cluster.cy + Math.sin(angle) * radius,
  };
}

function nodeRadius(device: Device) {
  if (device.open_ports.length >= 4) return 11;
  if (device.open_ports.length > 0) return 9 + device.open_ports.length * 0.4;
  if (device.alive) return 7;
  return 5.5;
}

function makeGlowSprite(color: string): HTMLCanvasElement {
  const size = 64;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function compareIP(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 4; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export default NetworkMap;
