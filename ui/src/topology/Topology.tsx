import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CenterFocusStrongOutlined from "@mui/icons-material/CenterFocusStrongOutlined";
import ViewInArOutlined from "@mui/icons-material/ViewInArOutlined";
import MapOutlined from "@mui/icons-material/MapOutlined";
import { CATEGORY_LABEL, hostLabel, type DeviceState, type HostObservation } from "../net";
import { useResolvedMode, usePrefersReducedMotion } from "../hooks/useResolvedMode";
import { visuallyHidden } from "../components/AppShell";
import { computeLayout, neighborIndex } from "./layout";
import { FlatTopology } from "./FlatTopology";
import type { SceneApi } from "./TopologyScene";

const TopologyScene = lazy(() => import("./TopologyScene"));

// SceneBoundary turns any failure to start or draw the 3D scene (renderer
// creation, a missing extension, a failed chunk load) into the flat map
// rather than an error page.
class SceneBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFail();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

declare global {
  interface Window {
    __netvizForceFlat?: boolean;
    __netvizTopology?: SceneApi & { renderer: "3d" | "flat" };
  }
}

function readPreference(): "3d" | "flat" {
  try {
    return window.localStorage.getItem("netviz.topologyView") === "flat" ? "flat" : "3d";
  } catch {
    return "3d";
  }
}

// Probed once per page load: each probe creates a WebGL context, and browsers
// cap how many can be alive at once.
let webglProbe: boolean | undefined;

export function webglAvailable() {
  if (typeof window === "undefined" || window.__netvizForceFlat) return false;
  if (webglProbe === undefined) {
    try {
      const canvas = document.createElement("canvas");
      // three.js r163+ renders with WebGL2 only; WebGL1-only systems get the flat map.
      const context = canvas.getContext("webgl2");
      webglProbe = Boolean(context);
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webglProbe = false;
    }
  }
  return webglProbe;
}

// Topology is the "see the network" view: a 3D map by default, the same
// layout flat when WebGL is missing, lost, or simply preferred. Keyboard: Tab
// into the map, arrows move between devices (up/down jump between device
// types), Enter opens the details, Escape clears the selection. The Devices
// view lists the same devices as a table.
export function Topology({
  hosts,
  states = {},
  selectedIP,
  onSelect,
  matches,
  scanning = false,
  label = "Network topology",
}: {
  hosts: HostObservation[];
  states?: Record<string, DeviceState>;
  selectedIP: string;
  onSelect: (ip: string) => void;
  matches: Set<string> | null;
  scanning?: boolean;
  label?: string;
}) {
  const mode = useResolvedMode();
  const reducedMotion = usePrefersReducedMotion();
  const layout = useMemo(() => computeLayout(hosts), [hosts]);
  const [webgl] = useState(webglAvailable);
  const [contextLost, setContextLost] = useState(false);
  const [preference, setPreference] = useState(readPreference);
  const renderer: "3d" | "flat" = webgl && !contextLost && preference === "3d" ? "3d" : "flat";
  const [hoverIP, setHoverIP] = useState("");
  const [cursorIP, setCursorIP] = useState("");
  const [focus, setFocus] = useState({ ip: "", seq: 0 });
  const [resetSeq, setResetSeq] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const labelLayer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedIP) setCursorIP(selectedIP);
  }, [selectedIP]);

  useEffect(() => {
    if (renderer === "flat") window.__netvizTopology = { renderer, bench: () => 0 };
  }, [renderer]);

  const onReady = useCallback((api: SceneApi) => {
    window.__netvizTopology = { ...api, renderer: "3d" };
    containerRef.current?.setAttribute("data-topology-ready", "true");
  }, []);

  function choose(view: "3d" | "flat") {
    setPreference(view);
    try {
      window.localStorage.setItem("netviz.topologyView", view);
    } catch {
      // A remembered view is a convenience; the default is fine.
    }
  }

  function announce(ip: string) {
    const node = layout.nodes.find((candidate) => candidate.host.ip === ip);
    if (!node) return;
    const ports = node.host.open_ports.length;
    setAnnouncement(
      `${hostLabel(node.host)}, ${ip}, ${node.gateway ? "gateway, " : ""}${CATEGORY_LABEL[node.category]}, ${ports ? `${ports} open port${ports === 1 ? "" : "s"}` : "no open ports"}`,
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const keys: Record<string, "next" | "previous" | "nextCluster" | "previousCluster"> = {
      ArrowRight: "next",
      ArrowLeft: "previous",
      ArrowDown: "nextCluster",
      ArrowUp: "previousCluster",
    };
    if (keys[event.key]) {
      event.preventDefault();
      const index = neighborIndex(layout, cursorIP, keys[event.key]);
      const ip = layout.nodes[index]?.host.ip;
      if (!ip) return;
      setCursorIP(ip);
      setHoverIP(ip);
      announce(ip);
    } else if (event.key === "Enter" && cursorIP) {
      event.preventDefault();
      onSelect(cursorIP);
      setFocus((current) => ({ ip: cursorIP, seq: current.seq + 1 }));
    } else if (event.key === "Escape") {
      onSelect("");
      setHoverIP("");
    }
  }

  return (
    <Box sx={{ position: "relative", flex: 1, minHeight: 320, overflow: "hidden", bgcolor: "background.default", color: "text.primary" }}>
      <Box
        ref={containerRef}
        data-topology-renderer={renderer}
        tabIndex={0}
        role="application"
        aria-roledescription="network map"
        aria-label={`${label}: ${hosts.length} devices. Use arrow keys to move between devices, Enter to open one. The Devices view lists the same devices as a table.`}
        onKeyDown={onKeyDown}
        sx={{ position: "absolute", inset: 0, outline: "none", "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "-2px" } }}
      >
        {renderer === "3d" ? (
          <SceneBoundary onFail={() => setContextLost(true)}>
          <Suspense fallback={<LinearProgress aria-label="Loading the 3D map" sx={{ position: "absolute", top: 0, left: 0, right: 0 }} />}>
            <TopologyScene
              layout={layout}
              mode={mode}
              states={states}
              selectedIP={selectedIP}
              hoverIP={hoverIP}
              matches={matches}
              scanning={scanning}
              reducedMotion={reducedMotion}
              focus={focus}
              resetSeq={resetSeq}
              onHover={setHoverIP}
              onSelect={(ip) => {
                onSelect(ip);
                if (ip) announce(ip);
              }}
              onFocusRequest={(ip) => {
                onSelect(ip);
                setFocus((current) => ({ ip, seq: current.seq + 1 }));
              }}
              onReady={onReady}
              onContextLost={() => setContextLost(true)}
              labelLayer={labelLayer as RefObject<HTMLElement>}
            />
          </Suspense>
          </SceneBoundary>
        ) : (
          <FlatTopology layout={layout} states={states} selectedIP={selectedIP} matches={matches} onSelect={onSelect} />
        )}
      </Box>
      <Box ref={labelLayer} aria-hidden="true" sx={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }} />

      <Stack direction="row" spacing={1} sx={{ position: "absolute", top: 12, right: 12 }}>
        {renderer === "3d" && (
          <Tooltip title="Back to the whole network">
            <Button variant="outlined" startIcon={<CenterFocusStrongOutlined />} onClick={() => setResetSeq((value) => value + 1)} sx={{ bgcolor: "background.paper" }}>
              Reset view
            </Button>
          </Tooltip>
        )}
        {webgl && !contextLost && (
          <ToggleButtonGroup exclusive value={preference} onChange={(_, value) => value && choose(value)} aria-label="Map style" sx={{ bgcolor: "background.paper" }}>
            <ToggleButton value="3d" aria-label="3D map">
              <ViewInArOutlined fontSize="small" />
            </ToggleButton>
            <ToggleButton value="flat" aria-label="Flat map">
              <MapOutlined fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
        )}
      </Stack>

      <Box sx={{ position: "absolute", left: 12, bottom: 10, right: 12, pointerEvents: "none" }}>
        {!webgl || contextLost ? (
          <Typography variant="caption" color="text.secondary" role="status">
            The 3D map isn't available on this system, so NetViz is showing the flat map.
          </Typography>
        ) : (
          renderer === "3d" && (
            <Typography variant="caption" color="text.secondary">
              Drag to orbit · scroll to zoom · double-click a device to fly to it · taller devices have more open ports
            </Typography>
          )
        )}
      </Box>

      <Box aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
    </Box>
  );
}
