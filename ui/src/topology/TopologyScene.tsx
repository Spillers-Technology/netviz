import { useEffect, useMemo, useRef, type ElementRef, type RefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { CATEGORY_COLORS } from "../categories";
import { CATEGORY_LABEL, formatPorts, hostLabel, type DeviceState } from "../net";
import { monoFont, surfaces } from "../theme";
import type { TopologyLayout, TopologyNode } from "./layout";

// TopologyScene is the three.js half of the topology view, loaded on demand.
// It renders only when something changes (frameloop "demand"): layout
// changes, hover, selection, camera moves, or a short spawn animation.

export type SceneApi = {
  // bench renders the scene n times and returns the mean milliseconds.
  bench: (frames: number) => number;
};

export type TopologySceneProps = {
  layout: TopologyLayout;
  mode: "light" | "dark";
  states: Record<string, DeviceState>;
  selectedIP: string;
  hoverIP: string;
  matches: Set<string> | null;
  scanning: boolean;
  reducedMotion: boolean;
  focus: { ip: string; seq: number };
  resetSeq: number;
  onHover: (ip: string) => void;
  onSelect: (ip: string) => void;
  onFocusRequest: (ip: string) => void;
  onReady: (api: SceneApi) => void;
  onContextLost: () => void;
  // Labels mount into this overlay, owned by the component that owns the
  // canvas, so unmounting the map never races the canvas's own DOM.
  labelLayer: RefObject<HTMLElement>;
};

const STATE_COLORS = {
  light: { new: "#0969da", online: "#1a7f37", offline: "#cf222e", changed: "#9a6700" },
  dark: { new: "#67dcff", online: "#4ade80", offline: "#f87171", changed: "#fbbf24" },
} as const;

type Palette = {
  background: string;
  floor: string;
  ring: string;
  text: string;
  muted: string;
  paper: string;
  line: string;
  accent: string;
};

function palette(mode: "light" | "dark"): Palette {
  return mode === "dark"
    ? { background: surfaces.dark.page, floor: "#0c1d33", ring: "#1f3a5a", text: "#e2e8f0", muted: "#94a3b8", paper: "rgba(16,36,59,0.92)", line: surfaces.dark.line, accent: "#00c2ff" }
    : { background: surfaces.light.page, floor: "#e8eef5", ring: "#c7d3e0", text: "#0f1b2d", muted: "#4a5a6e", paper: "rgba(255,255,255,0.94)", line: surfaces.light.line, accent: "#007fa8" };
}

export default function TopologyScene(props: TopologySceneProps) {
  const { layout, mode, onReady, onContextLost } = props;
  const colors = palette(mode);
  const bloom = mode === "dark";
  const distance = layout.extent * 2.1;
  // R3F forces a context loss when the canvas unmounts (for example when the
  // user picks the flat map). That is not a failure, so the listener only
  // reports losses while this scene is still mounted.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  return (
    <Canvas
      frameloop="demand"
      flat
      dpr={[1, 2]}
      camera={{ fov: 40, near: 0.1, far: 1000, position: [0, layout.extent * 1.35, layout.extent * 1.55] }}
      gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" }}
      onPointerMissed={() => props.onSelect("")}
      onCreated={(state) => {
        state.gl.domElement.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
          if (alive.current) onContextLost();
        });
        onReady({
          bench: (frames) => {
            const start = performance.now();
            for (let i = 0; i < frames; i += 1) state.gl.render(state.scene, state.camera);
            return (performance.now() - start) / frames;
          },
        });
      }}
      style={{ position: "absolute", inset: 0 }}
    >
      <color attach="background" args={[colors.background]} />
      <fog attach="fog" args={[colors.background, distance * 0.9, distance * 2.4]} />
      <ambientLight intensity={mode === "dark" ? 1.2 : 1.5} />
      <directionalLight position={[6, 12, 8]} intensity={mode === "dark" ? 1.4 : 1.2} />
      <hemisphereLight args={[mode === "dark" ? "#9fdcff" : "#ffffff", colors.floor, 0.5]} />
      <Floor layout={layout} colors={colors} mode={mode} />
      <Network {...props} colors={colors} />
      <Sweep active={props.scanning && !props.reducedMotion} radius={layout.extent + 1} color={colors.accent} />
      <Labels {...props} colors={colors} />
      <CameraRig layout={layout} focus={props.focus} resetSeq={props.resetSeq} reducedMotion={props.reducedMotion} />
      {bloom && (
        <EffectComposer multisampling={4}>
          <Bloom intensity={0.7} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
        </EffectComposer>
      )}
    </Canvas>
  );
}

function Floor({ layout, colors, mode }: { layout: TopologyLayout; colors: Palette; mode: "light" | "dark" }) {
  const ringLine = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i += 1) {
      const angle = (i / 128) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * layout.ringRadius, 0.01, Math.sin(angle) * layout.ringRadius));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: colors.ring, transparent: true, opacity: 0.7 }));
  }, [layout.ringRadius, colors.ring]);
  useEffect(
    () => () => {
      ringLine.geometry.dispose();
      (ringLine.material as THREE.Material).dispose();
    },
    [ringLine],
  );

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
        <circleGeometry args={[layout.extent + 2, 96]} />
        <meshBasicMaterial color={colors.floor} transparent opacity={0.85} />
      </mesh>
      <primitive object={ringLine} />
      {layout.clusters.map((cluster) => (
        <group key={cluster.category} position={[cluster.x, 0.005, cluster.z]} rotation-x={-Math.PI / 2}>
          <mesh>
            <circleGeometry args={[cluster.radius, 64]} />
            <meshBasicMaterial color={CATEGORY_COLORS[mode][cluster.category]} transparent opacity={mode === "dark" ? 0.06 : 0.08} depthWrite={false} />
          </mesh>
          <mesh>
            <ringGeometry args={[cluster.radius - 0.03, cluster.radius, 96]} />
            <meshBasicMaterial color={CATEGORY_COLORS[mode][cluster.category]} transparent opacity={0.45} depthWrite={false} />
          </mesh>
        </group>
      ))}
      {!layout.gateway && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[0.35, 0.5, 48]} />
          <meshBasicMaterial color={colors.muted} />
        </mesh>
      )}
    </group>
  );
}

type Animated = { x: number; y: number; z: number; scale: number };

function Network({
  layout,
  mode,
  states,
  selectedIP,
  hoverIP,
  matches,
  reducedMotion,
  onHover,
  onSelect,
  onFocusRequest,
  colors,
}: TopologySceneProps & { colors: Palette }) {
  const invalidate = useThree((state) => state.invalidate);
  const nodesRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);
  const selectRef = useRef<THREE.Mesh>(null);
  const edgesRef = useRef<THREE.LineSegments>(null);
  const pillarsRef = useRef<THREE.LineSegments>(null);
  const animated = useRef(new Map<string, Animated>());
  const born = useRef(new Map<string, number>());
  const dirty = useRef(true);

  const count = layout.nodes.length;
  // Grow capacity in powers of two so a live scan doesn't rebuild the
  // instanced meshes for every new device.
  const capacity = Math.max(64, 2 ** Math.ceil(Math.log2(count + 1)));

  const nodeGeometry = useMemo(() => new THREE.SphereGeometry(1, 20, 14), []);
  const haloGeometry = useMemo(() => new THREE.RingGeometry(1.35, 1.7, 40).rotateX(-Math.PI / 2), []);
  const edgeGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array((capacity + 16) * 6), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array((capacity + 16) * 6), 3));
    return geometry;
  }, [capacity]);
  const pillarGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 6), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(capacity * 6), 3));
    return geometry;
  }, [capacity]);

  useEffect(() => () => edgeGeometry.dispose(), [edgeGeometry]);
  useEffect(() => () => pillarGeometry.dispose(), [pillarGeometry]);
  useEffect(() => () => {
    nodeGeometry.dispose();
    haloGeometry.dispose();
  }, [nodeGeometry, haloGeometry]);

  // Per-node colors, recomputed only when what they depend on changes.
  const nodeColors = useMemo(() => {
    const background = new THREE.Color(colors.background);
    return layout.nodes.map((node) => {
      const active = node.host.alive || node.host.open_ports.length > 0;
      const base = new THREE.Color(CATEGORY_COLORS[mode][active ? node.category : "unknown"]);
      if (matches && !matches.has(node.host.ip)) base.lerp(background, 0.8);
      return base;
    });
  }, [layout, mode, matches, colors.background]);

  useEffect(() => {
    dirty.current = true;
    invalidate();
  }, [layout, nodeColors, states, selectedIP, hoverIP, invalidate]);

  useEffect(() => {
    const now = performance.now();
    for (const node of layout.nodes) {
      if (!born.current.has(node.host.ip)) born.current.set(node.host.ip, reducedMotion ? 0 : now);
    }
  }, [layout, reducedMotion]);

  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);
  const scaleVector = useMemo(() => new THREE.Vector3(), []);
  const scratch = useMemo(() => new THREE.Color(), []);

  useFrame((_, delta) => {
    const nodes = nodesRef.current;
    const halos = haloRef.current;
    const edges = edgesRef.current;
    const pillars = pillarsRef.current;
    if (!nodes || !halos || !edges || !pillars) return;
    const now = performance.now();
    const step = reducedMotion ? 1 : Math.min(1, delta * 7);
    let moving = false;

    const edgePositions = edges.geometry.getAttribute("position") as THREE.BufferAttribute;
    const edgeColors = edges.geometry.getAttribute("color") as THREE.BufferAttribute;
    const pillarPositions = pillars.geometry.getAttribute("position") as THREE.BufferAttribute;
    const pillarColors = pillars.geometry.getAttribute("color") as THREE.BufferAttribute;
    let edge = 0;
    let pillar = 0;
    let halo = 0;

    const hubY = layout.gateway ? layout.gateway.y : 0.05;
    for (const cluster of layout.clusters) {
      scratch.set(CATEGORY_COLORS[mode][cluster.category]);
      edgePositions.setXYZ(edge * 2, 0, hubY, 0);
      edgePositions.setXYZ(edge * 2 + 1, cluster.x, 0.02, cluster.z);
      edgeColors.setXYZ(edge * 2, scratch.r, scratch.g, scratch.b);
      edgeColors.setXYZ(edge * 2 + 1, scratch.r, scratch.g, scratch.b);
      edge += 1;
    }
    const clusterByCategory = new Map(layout.clusters.map((cluster) => [cluster.category, cluster]));

    layout.nodes.forEach((node, index) => {
      const ip = node.host.ip;
      let current = animated.current.get(ip);
      if (!current) {
        const cluster = clusterByCategory.get(node.category);
        current = reducedMotion
          ? { x: node.x, y: node.y, z: node.z, scale: 1 }
          : { x: cluster?.x ?? 0, y: 0, z: cluster?.z ?? 0, scale: 0 };
        animated.current.set(ip, current);
      }
      current.x += (node.x - current.x) * step;
      current.y += (node.y - current.y) * step;
      current.z += (node.z - current.z) * step;
      const age = now - (born.current.get(ip) ?? 0);
      current.scale = reducedMotion ? 1 : Math.min(1, age / 450);
      if (Math.abs(node.x - current.x) + Math.abs(node.y - current.y) + Math.abs(node.z - current.z) > 0.002 || current.scale < 1) moving = true;

      const emphasis = ip === selectedIP ? 1.3 : ip === hoverIP ? 1.18 : 1;
      const eased = 1 - Math.pow(1 - current.scale, 3);
      const size = node.size * emphasis * Math.max(eased, 0.001);
      position.set(current.x, current.y, current.z);
      scaleVector.set(size, size, size);
      matrix.compose(position, quaternion, scaleVector);
      nodes.setMatrixAt(index, matrix);
      nodes.setColorAt(index, nodeColors[index]);

      if (!node.gateway) {
        const cluster = clusterByCategory.get(node.category);
        if (cluster) {
          edgePositions.setXYZ(edge * 2, cluster.x, 0.02, cluster.z);
          edgePositions.setXYZ(edge * 2 + 1, current.x, current.y, current.z);
          const color = nodeColors[index];
          edgeColors.setXYZ(edge * 2, color.r, color.g, color.b);
          edgeColors.setXYZ(edge * 2 + 1, color.r, color.g, color.b);
          edge += 1;
        }
      }
      if (node.host.open_ports.length > 0) {
        const color = nodeColors[index];
        pillarPositions.setXYZ(pillar * 2, current.x, 0, current.z);
        pillarPositions.setXYZ(pillar * 2 + 1, current.x, current.y, current.z);
        pillarColors.setXYZ(pillar * 2, color.r * 0.4, color.g * 0.4, color.b * 0.4);
        pillarColors.setXYZ(pillar * 2 + 1, color.r, color.g, color.b);
        pillar += 1;
      }
      const state = states[ip];
      if (state && state !== "stable") {
        const haloSize = node.size * Math.max(eased, 0.001);
        position.set(current.x, current.y, current.z);
        scaleVector.set(haloSize, haloSize, haloSize);
        matrix.compose(position, quaternion, scaleVector);
        halos.setMatrixAt(halo, matrix);
        // Brighter than 1.0 in the dark scheme so bloom picks the halos up.
        scratch.set(STATE_COLORS[mode][state]).multiplyScalar(mode === "dark" ? 1.8 : 1);
        halos.setColorAt(halo, scratch);
        halo += 1;
      }
    });

    nodes.count = count;
    nodes.instanceMatrix.needsUpdate = true;
    if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true;
    nodes.computeBoundingSphere();
    halos.count = halo;
    halos.instanceMatrix.needsUpdate = true;
    if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
    // Stale bounds would cull halos added after the first frame.
    halos.computeBoundingSphere();
    edges.geometry.setDrawRange(0, edge * 2);
    edgePositions.needsUpdate = true;
    edgeColors.needsUpdate = true;
    edges.geometry.computeBoundingSphere();
    pillars.geometry.setDrawRange(0, pillar * 2);
    pillarPositions.needsUpdate = true;
    pillarColors.needsUpdate = true;
    pillars.geometry.computeBoundingSphere();

    const selected = selectRef.current;
    if (selected) {
      const current = selectedIP ? animated.current.get(selectedIP) : undefined;
      const node = selectedIP ? layout.nodes.find((candidate) => candidate.host.ip === selectedIP) : undefined;
      selected.visible = Boolean(current && node);
      if (current && node) {
        selected.position.set(current.x, 0.02, current.z);
        selected.scale.setScalar(node.size * 2.4);
      }
    }

    dirty.current = false;
    if (moving) invalidate();
  });

  function ipAt(event: ThreeEvent<PointerEvent | MouseEvent>) {
    return event.instanceId === undefined ? "" : layout.nodes[event.instanceId]?.host.ip || "";
  }

  return (
    <group>
      <lineSegments ref={edgesRef} geometry={edgeGeometry} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={mode === "dark" ? 0.32 : 0.45} />
      </lineSegments>
      <lineSegments ref={pillarsRef} geometry={pillarGeometry} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.7} />
      </lineSegments>
      <instancedMesh
        key={`nodes-${capacity}`}
        ref={nodesRef}
        args={[nodeGeometry, undefined, capacity]}
        onPointerMove={(event) => {
          event.stopPropagation();
          const ip = ipAt(event);
          if (ip !== hoverIP) onHover(ip);
          document.body.style.cursor = ip ? "pointer" : "";
        }}
        onPointerOut={() => {
          onHover("");
          document.body.style.cursor = "";
        }}
        onClick={(event) => {
          event.stopPropagation();
          const ip = ipAt(event);
          onSelect(ip === selectedIP ? "" : ip);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          const ip = ipAt(event);
          if (ip) onFocusRequest(ip);
        }}
      >
        <meshStandardMaterial roughness={0.45} metalness={0.08} />
      </instancedMesh>
      <instancedMesh key={`halos-${capacity}`} ref={haloRef} args={[haloGeometry, undefined, capacity]} raycast={() => null}>
        <meshBasicMaterial toneMapped={false} transparent opacity={0.95} side={THREE.DoubleSide} />
      </instancedMesh>
      <mesh ref={selectRef} visible={false} rotation-x={-Math.PI / 2} raycast={() => null}>
        <ringGeometry args={[0.9, 1.05, 48]} />
        <meshBasicMaterial color={colors.accent} toneMapped={false} side={THREE.DoubleSide} transparent opacity={0.95} />
      </mesh>
    </group>
  );
}

// Sweep is the radar arm that turns while a scan is running.
function Sweep({ active, radius, color }: { active: boolean; radius: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (active) invalidate();
  }, [active, invalidate]);
  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.visible = active;
    if (!active) return;
    ref.current.rotation.z -= delta * 1.4;
    invalidate();
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position-y={0.03} visible={active} raycast={() => null}>
      <ringGeometry args={[0.6, radius, 64, 1, 0, Math.PI / 5]} />
      <meshBasicMaterial color={color} transparent opacity={0.1} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function CameraRig({
  layout,
  focus,
  resetSeq,
  reducedMotion,
}: {
  layout: TopologyLayout;
  focus: { ip: string; seq: number };
  resetSeq: number;
  reducedMotion: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const goal = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const userMoved = useRef(false);

  const size = useThree((state) => state.size);
  // Frame the whole network: pull back far enough that its footprint fits
  // the narrower of the two canvas dimensions, looking down at about 45°.
  const home = useMemo(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const radius = layout.extent + 1.2;
    const fit = radius / Math.tan(THREE.MathUtils.degToRad(20));
    const distance = fit * Math.max(1, 1.1 / aspect) * 1.02;
    // Aim a little toward the viewer: perspective makes near clusters larger,
    // so this keeps the whole ring balanced in the frame.
    const target = new THREE.Vector3(0, 0, radius * 0.12);
    return { position: new THREE.Vector3(0, distance * 0.72, distance * 0.7 + target.z), target };
  }, [layout.extent, size.width, size.height]);

  // Follow the network's size while it grows during a scan, until the user
  // takes the camera; Reset view hands it back.
  useEffect(() => {
    if (!userMoved.current) {
      goal.current = { position: home.position.clone(), target: home.target.clone() };
      invalidate();
    }
  }, [home, invalidate]);

  useEffect(() => {
    if (resetSeq === 0) return;
    userMoved.current = false;
    goal.current = { position: home.position.clone(), target: home.target.clone() };
    invalidate();
  }, [resetSeq, home, invalidate]);

  useEffect(() => {
    if (!focus.ip) return;
    const node = layout.nodes.find((candidate) => candidate.host.ip === focus.ip);
    if (!node) return;
    userMoved.current = true;
    const target = new THREE.Vector3(node.x, node.y * 0.5, node.z);
    const outward = new THREE.Vector3(node.x, 0, node.z).normalize();
    if (!Number.isFinite(outward.x)) outward.set(0, 0, 1);
    goal.current = { target, position: target.clone().add(outward.multiplyScalar(4.5)).add(new THREE.Vector3(0, 4.2, 0)) };
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.seq]);

  useFrame((_, delta) => {
    const current = controls.current;
    if (!goal.current || !current) return;
    const t = reducedMotion ? 1 : Math.min(1, delta * 4.5);
    camera.position.lerp(goal.current.position, t);
    current.target.lerp(goal.current.target, t);
    current.update();
    if (camera.position.distanceTo(goal.current.position) < 0.01 && current.target.distanceTo(goal.current.target) < 0.01) {
      goal.current = null;
    } else {
      invalidate();
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={!reducedMotion}
      dampingFactor={0.12}
      maxPolarAngle={1.32}
      minDistance={2.5}
      // Always reachable from the home view, or the camera rig would chase a
      // clamped position forever and never stop rendering.
      maxDistance={Math.max(layout.extent * 5 + 10, home.position.distanceTo(home.target) * 1.5)}
      onStart={() => {
        userMoved.current = true;
        goal.current = null;
      }}
    />
  );
}

function Labels({ layout, mode, hoverIP, selectedIP, colors, labelLayer }: TopologySceneProps & { colors: Palette }) {
  const hovered = hoverIP ? layout.nodes.find((node) => node.host.ip === hoverIP) : undefined;
  const selected = selectedIP && selectedIP !== hoverIP ? layout.nodes.find((node) => node.host.ip === selectedIP) : undefined;
  const pill = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 9px",
    borderRadius: 999,
    background: colors.paper,
    border: `1px solid ${colors.line}`,
    color: colors.text,
    font: "600 12px 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
    whiteSpace: "nowrap" as const,
    pointerEvents: "none" as const,
    userSelect: "none" as const,
  };

  return (
    <group>
      {layout.clusters.map((cluster) => {
        // Labels sit just behind their cluster (away from the camera), so on
        // screen they always read above it and never run off the canvas edge.
        return (
          <Html portal={labelLayer}
            key={cluster.category}
            position={[cluster.x, 0.05, cluster.z - cluster.radius - 0.55]}
            center
            zIndexRange={[20, 0]}
          >
            <div style={pill} data-cluster={cluster.category}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: CATEGORY_COLORS[mode][cluster.category] }} />
              {CATEGORY_LABEL[cluster.category]}
              <span style={{ color: colors.muted, fontWeight: 400 }}>{cluster.count}</span>
            </div>
          </Html>
        );
      })}
      {layout.gateway && (
        <Html portal={labelLayer} position={[0, -0.05, 0]} center zIndexRange={[20, 0]}>
          <div style={{ ...pill, transform: "translateY(22px)" }}>
            Gateway <span style={{ fontFamily: monoFont, fontWeight: 400, color: colors.muted }}>{layout.gateway.host.ip}</span>
          </div>
        </Html>
      )}
      {selected && <NodeTag node={selected} pill={pill} labelLayer={labelLayer} />}
      {hovered && <NodeTooltip node={hovered} colors={colors} labelLayer={labelLayer} />}
    </group>
  );
}

function NodeTag({ node, pill, labelLayer }: { node: TopologyNode; pill: Record<string, unknown>; labelLayer: RefObject<HTMLElement> }) {
  return (
    <Html portal={labelLayer} position={[node.x, node.y + node.size + 0.25, node.z]} center zIndexRange={[30, 0]}>
      <div style={{ ...pill, transform: "translateY(-12px)" }}>{hostLabel(node.host)}</div>
    </Html>
  );
}

function NodeTooltip({ node, colors, labelLayer }: { node: TopologyNode; colors: Palette; labelLayer: RefObject<HTMLElement> }) {
  const ports = node.host.open_ports;
  return (
    <Html portal={labelLayer} position={[node.x, node.y + node.size + 0.25, node.z]} center zIndexRange={[40, 0]}>
      <div
        role="tooltip"
        style={{
          transform: "translateY(calc(-50% - 14px))",
          minWidth: 180,
          maxWidth: 280,
          padding: "8px 10px",
          borderRadius: 8,
          background: colors.paper,
          border: `1px solid ${colors.line}`,
          color: colors.text,
          font: "12px 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          pointerEvents: "none",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hostLabel(node.host)}</div>
        <div style={{ fontFamily: monoFont, color: colors.muted }}>{node.host.ip}</div>
        <div style={{ marginTop: 4 }}>
          {node.gateway ? "Gateway · " : ""}
          {CATEGORY_LABEL[node.category]}
          {node.host.vendor ? ` · ${node.host.vendor}` : ""}
        </div>
        <div style={{ marginTop: 2, color: colors.muted }}>
          {ports.length ? `Open: ${formatPorts(ports.slice(0, 5))}${ports.length > 5 ? ` +${ports.length - 5}` : ""}` : "No scanned ports open"}
        </div>
      </div>
    </Html>
  );
}
