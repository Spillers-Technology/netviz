import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { Device, ProbeStatus, ServerState } from "./types";
import NetworkMap from "./NetworkMap";
import { demoState } from "./demo";

const REFRESH_MS = 10000;
const PROBE_STALE_MS = 5 * 60 * 1000;

function App() {
  const demo = useMemo(() => new URLSearchParams(window.location.search).has("demo"), []);
  const [state, setState] = useState<ServerState | null>(null);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [identity, setIdentity] = useState<{ auth: boolean; email?: string; name?: string } | null>(null);

  useEffect(() => {
    if (demo) return;
    fetch("/api/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((me) => setIdentity(me))
      .catch(() => {});
  }, [demo]);

  async function refresh() {
    if (demo) {
      setState(demoState());
      setRefreshedAt(new Date());
      return;
    }
    try {
      const response = await fetch("/api/state");
      if (!response.ok) throw new Error(`state request failed with status ${response.status}`);
      setState((await response.json()) as ServerState);
      setRefreshedAt(new Date());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const devices = state?.devices ?? [];
  const upCount = devices.filter((device) => device.alive).length;
  const openPortCount = devices.reduce((sum, device) => sum + device.open_ports.length, 0);
  const cidr = state?.run?.cidr || state?.probe?.cidr || "";

  return (
    <main className="shell">
      <header className="topBar">
        <div>
          <h1>NetViz Server</h1>
          <p className="quiet">
            {state ? `netviz-server ${state.version}` : "connecting"}
            {refreshedAt ? ` · refreshed ${refreshedAt.toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="topActions">
          <ProbeBadge probe={state?.probe} />
          {identity?.auth && (
            <span className="identity">
              {identity.name || identity.email || "signed in"} · <a href="/auth/logout">sign out</a>
            </span>
          )}
          <button onClick={() => void refresh()}>Refresh</button>
        </div>
      </header>

      {demo && (
        <div className="demoBanner">
          Demo data — remove <code>?demo</code> from the URL to see live state.
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <section className="tiles" aria-label="Network summary">
        <StatTile label="Devices" value={devices.length} />
        <StatTile label="Up" value={upCount} />
        <StatTile label="Open ports" value={openPortCount} />
        <StatTile
          label="Last push"
          value={state?.run ? new Date(state.run.ended_at || state.run.started_at).toLocaleTimeString() : "—"}
          detail={state?.run ? state.run.cidr : "no runs stored"}
        />
      </section>

      {devices.length > 0 && <NetworkMap devices={devices} cidr={cidr} />}

      <section className="tableWrap" aria-label="Latest device inventory">
        {devices.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>IP</th>
                <th>Hostname</th>
                <th>MAC</th>
                <th>Vendor</th>
                <th>Status</th>
                <th>Open ports</th>
                <th>Device type</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.ip}>
                  <td>{device.ip}</td>
                  <td>{device.hostname || ""}</td>
                  <td>{device.mac_address || ""}</td>
                  <td>{device.vendor || ""}</td>
                  <td>
                    <span className={`statusPill ${device.alive ? "up" : "down"}`}>
                      {device.alive ? "up" : "down"}
                    </span>
                  </td>
                  <td>{device.open_ports.map((port) => port.port).join(", ")}</td>
                  <td>{device.device_type}</td>
                  <td>{formatTime(device.last_updated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState connected={Boolean(state)} />
        )}
      </section>
    </main>
  );
}

function StatTile({ label, value, detail }: { label: string; value: number | string; detail?: string }) {
  return (
    <div className="tile">
      <span className="tileLabel">{label}</span>
      <strong className="tileValue">{value}</strong>
      {detail && <span className="tileDetail">{detail}</span>}
    </div>
  );
}

function ProbeBadge({ probe }: { probe?: ProbeStatus }) {
  if (!probe) {
    return <span className="probeBadge none">no probe heartbeat yet</span>;
  }
  const ageMs = Date.now() - new Date(probe.last_seen).getTime();
  const stale = ageMs > PROBE_STALE_MS;
  return (
    <span className={`probeBadge ${stale ? "stale" : "fresh"}`}>
      probe {stale ? "stale" : "online"} · seen {formatAge(ageMs)} ago
      {probe.cidr ? ` · ${probe.cidr}` : ""}
    </span>
  );
}

function EmptyState({ connected }: { connected: boolean }) {
  return (
    <div className="emptyState">
      <h2>{connected ? "No device pushes yet" : "Connecting to server"}</h2>
      <p>
        Point a probe at this server and it will appear here after its first
        scan cycle:
      </p>
      <pre>netviz-probe -url http://&lt;this-host&gt;:8080 -key &lt;ingest key&gt; -cidr 192.168.1.0/24</pre>
      <p className="quiet">
        The ingest key is set on the server with <code>-ingest-key</code> or the
        <code> NETVIZ_INGEST_KEY</code> environment variable. Curious what the
        map looks like? Open <a href="?demo">?demo</a> for sample data.
      </p>
    </div>
  );
}

function formatTime(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function formatAge(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
