import { useCallback, useEffect, useState } from "react";
import { useAsyncAction } from "@netviz/ui";
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
// once the user checks on purpose.
export function useUpdates() {
  const [info, setInfo] = useState<UpdateInfo>(unknown);
  const [checked, setChecked] = useState(false);
  const action = useAsyncAction("Checking for updates");

  const check = useCallback(
    async (quiet = false) => {
      if (quiet) {
        try {
          setInfo(await app().CheckForUpdate());
          setChecked(true);
        } catch {
          // A quiet startup check stays quiet; Settings can check again.
        }
        return;
      }
      const result = await action.run(() => app().CheckForUpdate(), "Checking for updates");
      if (result) {
        setInfo(result);
        setChecked(true);
      }
    },
    [action],
  );

  useEffect(() => {
    if (hasBridge()) void check(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = useCallback(async () => {
    const result = await action.run(() => app().DownloadLatestUpdate(), "Downloading the update");
    if (result) setInfo(result);
  }, [action]);

  const openDownload = useCallback(async () => {
    await action.run(() => app().OpenUpdateDownload(info.download_path), "Showing the download");
  }, [action, info.download_path]);

  const apply = useCallback(async () => {
    const message = await action.run(() => app().ApplyDownloadedUpdate(info.download_path), "Installing the update");
    if (message !== undefined) setInfo((current) => ({ ...current, message }));
  }, [action, info.download_path]);

  return { info, checked, busy: action.busy, error: action.error, clearError: action.clear, check, download, openDownload, apply };
}

export type UpdatesState = ReturnType<typeof useUpdates>;
