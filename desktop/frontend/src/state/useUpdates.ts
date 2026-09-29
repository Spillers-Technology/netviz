import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError, type FriendlyError } from "@netviz/ui";
import { app, hasBridge, type UpdateInfo } from "../bridge";

const unknown: UpdateInfo = {
  current_version: "",
  latest_version: "",
  available: false,
  release_url: "",
  asset_name: "",
  asset_url: "",
  checksum_name: "",
  checksum_url: "",
  download_path: "",
  message: "",
};

// useUpdates checks for a newer release quietly at startup; errors only show
// once the user checks on purpose. Every request takes a sequence number and
// only the newest one may change state, so a slow startup check can never
// overwrite a download the user finished in the meantime.
export function useUpdates() {
  const [info, setInfo] = useState<UpdateInfo>(unknown);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<FriendlyError | null>(null);
  const latest = useRef(0);

  const track = useCallback(async <T,>(task: () => Promise<T>, action: string, quiet = false): Promise<T | undefined> => {
    const id = ++latest.current;
    setPending((count) => count + 1);
    if (!quiet) setError(null);
    try {
      const result = await task();
      return id === latest.current ? result : undefined;
    } catch (err) {
      if (!quiet && id === latest.current) setError(friendlyError(err, action));
      return undefined;
    } finally {
      setPending((count) => count - 1);
    }
  }, []);

  const check = useCallback(
    async (quiet = false) => {
      const result = await track(() => app().CheckForUpdate(), "Checking for updates", quiet);
      if (result) {
        setInfo(result);
        setChecked(true);
      }
    },
    [track],
  );

  useEffect(() => {
    if (hasBridge()) void check(true);
  }, [check]);

  const download = useCallback(async () => {
    const result = await track(() => app().DownloadLatestUpdate(), "Downloading the update");
    if (result) setInfo(result);
  }, [track]);

  const openDownload = useCallback(async () => {
    await track(() => app().OpenUpdateDownload(info.download_path), "Showing the download");
  }, [track, info.download_path]);

  const apply = useCallback(async () => {
    const message = await track(() => app().ApplyDownloadedUpdate(info.download_path), "Installing the update");
    if (message !== undefined) setInfo((current) => ({ ...current, message }));
  }, [track, info.download_path]);

  return { info, checked, busy: pending > 0, error, clearError: () => setError(null), check, download, openDownload, apply };
}

export type UpdatesState = ReturnType<typeof useUpdates>;
