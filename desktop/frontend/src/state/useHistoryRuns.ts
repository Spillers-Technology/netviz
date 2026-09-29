import { useCallback, useEffect, useState } from "react";
import { friendlyError, type FriendlyError, type ScanRun } from "@netviz/ui";
import { app, emptyDiff, hasBridge, onEvent, type ScanDiff } from "../bridge";

type Load = { status: "loading" } | { status: "ready" } | { status: "error"; error: FriendlyError };

// useHistoryRuns keeps the saved-run list and latest diff fresh: it reloads
// whenever the backend reports a new run, and surfaces storage errors.
export function useHistoryRuns() {
  const [runs, setRuns] = useState<ScanRun[]>([]);
  const [latest, setLatest] = useState<ScanDiff>(emptyDiff);
  const [load, setLoad] = useState<Load>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const [list, diff] = await Promise.all([app().ListHistory(), app().LatestDiff()]);
      setRuns(list || []);
      setLatest(diff || emptyDiff);
      setLoad({ status: "ready" });
    } catch (err) {
      setLoad({ status: "error", error: friendlyError(err, "Loading saved scans") });
    }
  }, []);

  useEffect(() => {
    if (!hasBridge()) return;
    void refresh();
    const offs = [
      onEvent("history:updated", () => void refresh()),
      onEvent("history:error", (payload) => setLoad({ status: "error", error: friendlyError(payload, "Saving scan history") })),
    ];
    return () => offs.forEach((off) => off());
  }, [refresh]);

  return { runs, latest, load, refresh };
}

export type HistoryState = ReturnType<typeof useHistoryRuns>;
