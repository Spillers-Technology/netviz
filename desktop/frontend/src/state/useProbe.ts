import { useCallback, useEffect, useState } from "react";
import { useAsyncAction } from "@netviz/ui";
import { app, hasBridge, type ProbeServiceStatus } from "../bridge";

const initial: ProbeServiceStatus = {
  probe_path: "",
  install_path: "",
  config_path: "",
  found: false,
  state: "unknown",
  severity: "info",
  summary: "",
  message: "",
  output: "",
};

// useProbe keeps the probe's own configuration, separate from the scan range
// on the Network page: setting up a probe never changes what you're scanning.
export function useProbe(defaultCidr: string) {
  const [status, setStatus] = useState<ProbeServiceStatus>(initial);
  const [loaded, setLoaded] = useState(false);
  const [cidr, setCidr] = useState("");
  const [url, setURL] = useState("");
  const [key, setKey] = useState("");
  const [interval, setInterval] = useState("1m");
  const [probePath, setProbePath] = useState("");
  const [installPersistent, setInstallPersistent] = useState(true);
  const [startAfterInstall, setStartAfterInstall] = useState(true);
  const action = useAsyncAction("That probe action");

  // After provisioning or a service action the backend reports where the
  // probe now lives (the install location), which replaces a temporary path
  // the user picked; a plain status read keeps the user's choice.
  const adopt = useCallback((next: ProbeServiceStatus, fromConfig: boolean, replacePath = false) => {
    setStatus(next);
    if (next.probe_path) setProbePath((current) => (replacePath ? next.probe_path : current || next.probe_path));
    if (fromConfig && next.config) {
      setCidr(next.config.cidr);
      setURL(next.config.anchordesk_url);
      setKey(next.config.probe_key);
      setInterval(next.config.interval || "1m");
    }
  }, []);

  const refresh = useCallback(
    async (path = probePath) => {
      const next = await action.run(() => app().GetProbeStatus(path), "Reading the probe status");
      if (next) adopt(next, !loaded);
      setLoaded(true);
    },
    [action, adopt, loaded, probePath],
  );

  useEffect(() => {
    if (hasBridge()) void refresh("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loaded && !cidr && defaultCidr) setCidr(defaultCidr);
  }, [loaded, cidr, defaultCidr]);

  const locate = useCallback(async () => {
    const chosen = await action.run(() => app().ChooseProbeBinary(), "Choosing netviz-probe");
    if (!chosen) return;
    setProbePath(chosen);
    await refresh(chosen);
  }, [action, refresh]);

  const provision = useCallback(async () => {
    const next = await action.run(
      () =>
        app().ProvisionProbe({
          cidr: cidr.trim(),
          anchordesk_url: url.trim(),
          probe_key: key,
          interval,
          probe_path: probePath,
          install_persistent: installPersistent,
          start_after_install: startAfterInstall,
        }),
      installPersistent ? "Installing the probe" : "Sending the report",
    );
    if (next) adopt(next, false, true);
    return Boolean(next);
  }, [action, adopt, cidr, url, key, interval, probePath, installPersistent, startAfterInstall]);

  const serviceAction = useCallback(
    async (verb: "start" | "stop" | "restart" | "uninstall") => {
      const doing = { start: "Starting", stop: "Stopping", restart: "Restarting", uninstall: "Uninstalling" }[verb];
      const next = await action.run(() => app().ProbeServiceAction(verb, probePath), `${doing} the probe service`);
      if (next) adopt(next, false, true);
    },
    [action, adopt, probePath],
  );

  return {
    status,
    loaded,
    busy: action.busy,
    error: action.error,
    clearError: action.clear,
    form: { cidr, setCidr, url, setURL, key, setKey, interval, setInterval, installPersistent, setInstallPersistent, startAfterInstall, setStartAfterInstall },
    probePath,
    refresh,
    locate,
    provision,
    serviceAction,
  };
}

export type ProbeState = ReturnType<typeof useProbe>;
