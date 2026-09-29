import { useEffect, useState } from "react";

// Settings persist best-effort in localStorage under the netviz.* keys the
// app has always used; storage failures never break the app.

export function readSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Persistence is a convenience.
  }
}

export function useStoredState<T>(key: string, fallback: T, parse: (raw: string) => T | undefined, serialize: (value: T) => string = String) {
  const [value, setValue] = useState<T>(() => {
    const raw = readSetting(key);
    if (raw === null) return fallback;
    try {
      const parsed = parse(raw);
      return parsed === undefined ? fallback : parsed;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    writeSetting(key, serialize(value));
  }, [key, value, serialize]);
  return [value, setValue] as const;
}

export const MONITOR_INTERVALS = [
  { label: "15 seconds", short: "15s", ms: 15_000 },
  { label: "30 seconds", short: "30s", ms: 30_000 },
  { label: "1 minute", short: "1m", ms: 60_000 },
  { label: "5 minutes", short: "5m", ms: 300_000 },
];

export const MAX_PORTS = 64;
