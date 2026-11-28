import { useState } from "react";
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, MenuItem,
  Paper, Stack, TextField, Typography,
} from "@mui/material";

export interface ManagedCompany { id: string; name: string }
export interface ManagedProbe {
  id: string;
  name: string;
  site: string;
  companyId: string | null;
  cidr: string;
  lastSeenAt: string | null;
}
interface ManagedDevice {
  id: string;
  probeId: string;
  companyId: string | null;
  companyOverride: boolean;
  observation: { hostname?: string; ip?: string; mac?: string };
}
export interface ManagedInventory {
  companies: ManagedCompany[];
  probes: ManagedProbe[];
  devices: ManagedDevice[];
}

export async function requestManagement<T>(path = "", method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/management${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? `NetViz returned HTTP ${response.status}.`);
  }
  return response.status === 204 ? undefined as T : response.json();
}

export default function ManagedProbes({ inventory, onChanged }: {
  inventory: ManagedInventory;
  onChanged: () => Promise<void>;
}) {
  const [probe, setProbe] = useState<ManagedProbe | null>();
  const [company, setCompany] = useState<ManagedCompany | null>();
  const [device, setDevice] = useState<ManagedDevice | null>(null);
  const [enrollment, setEnrollment] = useState<{ key: string; name: string } | null>(null);
  const [rotate, setRotate] = useState<ManagedProbe | null>(null);
  const [selectedProbe, setSelectedProbe] = useState("");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [actionError, setActionError] = useState("");
  const [copyLabel, setCopyLabel] = useState("Copy key");
  const [rotating, setRotating] = useState(false);
  const probeFilter = selectedProbe || inventory.probes[0]?.id || "";
  const needle = deviceSearch.trim().toLowerCase();
  const devices = inventory.devices.filter((row) =>
    row.probeId === probeFilter && [row.observation.hostname, row.observation.ip, row.observation.mac, row.id]
      .some((item) => item?.toLowerCase().includes(needle)),
  );
  const companyName = (id: string | null) => inventory.companies.find((item) => item.id === id)?.name ?? "Unassigned";
  const showKey = (name: string, key: string) => {
    setCopyLabel("Copy key");
    setEnrollment({ name, key });
  };

  return (
    <Stack spacing={2}>
      {actionError && <Alert severity="error" onClose={() => setActionError("")}>{actionError}</Alert>}
      <Paper component="section" sx={{ p: 2 }}>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography variant="h2">Managed probes</Typography>
          <Button variant="contained" onClick={() => setProbe(null)}>New probe</Button>
        </Stack>
        {inventory.probes.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Register a probe for each scanner you deploy.</Typography>
        )}
        <Stack divider={<Divider />} spacing={1.25} sx={{ mt: 1.5 }}>
          {inventory.probes.map((row) => (
            <Stack key={row.id} direction={{ xs: "column", sm: "row" }} sx={{ justifyContent: "space-between", gap: 1 }}>
              <Box sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                <Typography variant="subtitle2">{row.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {[row.site, row.cidr, companyName(row.companyId)].filter(Boolean).join(" · ")}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {row.lastSeenAt ? `Last report ${new Date(row.lastSeenAt).toLocaleString()}` : "Waiting for first report"}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button size="small" aria-label={`Edit probe ${row.name}`} onClick={() => setProbe(row)}>Edit</Button>
                <Button size="small" aria-label={`Rotate key for ${row.name}`} onClick={() => setRotate(row)}>Rotate key</Button>
              </Stack>
            </Stack>
          ))}
        </Stack>
      </Paper>
      <Paper component="section" sx={{ p: 2 }}>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography variant="h2">Companies</Typography>
          <Button onClick={() => setCompany(null)}>New company</Button>
        </Stack>
        <Stack divider={<Divider />} spacing={1} sx={{ mt: 1 }}>
          {inventory.companies.map((row) => (
            <Stack key={row.id} direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
              <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{row.name}</Typography>
              <Button size="small" aria-label={`Edit company ${row.name}`} onClick={() => setCompany(row)}>Edit</Button>
            </Stack>
          ))}
        </Stack>
      </Paper>
      {inventory.probes.length > 0 && (
        <Paper component="section" sx={{ p: 2 }}>
          <Typography variant="h2" sx={{ mb: 1.5 }}>Device assignments</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField select size="small" label="Probe" value={probeFilter} onChange={(event) => setSelectedProbe(event.target.value)} sx={{ minWidth: 180 }}>
              {inventory.probes.map((row) => <MenuItem key={row.id} value={row.id}>{row.site} · {row.name}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Find device" value={deviceSearch} onChange={(event) => setDeviceSearch(event.target.value)} />
          </Stack>
          {devices.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>No matching devices.</Typography>}
          <Stack divider={<Divider />} spacing={1} sx={{ mt: 1.5 }}>
            {devices.map((row) => {
              const name = row.observation.hostname || row.observation.ip || row.id;
              return (
                <Stack key={row.id} direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                  <Box sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                    <Typography variant="subtitle2">{name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {companyName(row.companyId)}{row.companyOverride ? "" : " · From probe"}
                    </Typography>
                  </Box>
                  <Button size="small" aria-label={`Assign company for ${name}`} onClick={() => setDevice(row)}>Assign</Button>
                </Stack>
              );
            })}
          </Stack>
        </Paper>
      )}
      {probe !== undefined && (
        <ProbeForm
          probe={probe}
          companies={inventory.companies}
          onClose={() => setProbe(undefined)}
          onSave={async (values) => {
            const result = probe
              ? await requestManagement<void>(`/probes/${probe.id}`, "PUT", values)
              : await requestManagement<{ key: string }>("/probes", "POST", values);
            if (result) showKey(values.name, result.key);
            setProbe(undefined);
            await onChanged();
          }}
        />
      )}
      {company !== undefined && (
        <CompanyForm
          company={company}
          onClose={() => setCompany(undefined)}
          onSave={async (name) => {
            await requestManagement(company ? `/companies/${company.id}` : "/companies", company ? "PUT" : "POST", { name });
            setCompany(undefined);
            await onChanged();
          }}
        />
      )}
      {device && (
        <DeviceCompanyForm
          device={device}
          companies={inventory.companies}
          onClose={() => setDevice(null)}
          onSave={async (value) => {
            await requestManagement(`/devices/${encodeURIComponent(device.id)}/company`, "PUT", {
              override: value !== "inherit",
              companyId: value === "inherit" || value === "none" ? null : value,
            });
            setDevice(null);
            await onChanged();
          }}
        />
      )}
      {rotate && (
        <Dialog open fullWidth maxWidth="xs" onClose={rotating ? undefined : () => setRotate(null)}>
          <DialogTitle>Rotate {rotate.name}’s key?</DialogTitle>
          <DialogContent>The old key stops working immediately. Update the scanner with the replacement key.</DialogContent>
          <DialogActions>
            <Button disabled={rotating} onClick={() => setRotate(null)}>Cancel</Button>
            <Button variant="contained" color="warning" disabled={rotating} onClick={async () => {
              setRotating(true);
              try {
                const result = await requestManagement<{ key: string }>(`/probes/${rotate.id}/rotate-key`, "POST", {});
                showKey(rotate.name, result.key);
                setRotate(null);
              } catch (error) {
                setActionError((error as Error).message);
                setRotate(null);
              } finally {
                setRotating(false);
              }
            }}>Rotate key</Button>
          </DialogActions>
        </Dialog>
      )}
      {enrollment && (
        <Dialog open fullWidth maxWidth="sm" onClose={() => setEnrollment(null)}>
          <DialogTitle>Connect {enrollment.name}</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5} sx={{ pt: 0.5 }}>
              <Typography variant="body2">Set this server URL and probe key in the scanner configuration. Save the key now. It is shown once.</Typography>
              <TextField label="Server URL" value={window.location.origin} slotProps={{ input: { readOnly: true } }} />
              <TextField label="Probe key" value={enrollment.key} slotProps={{ input: { readOnly: true } }} />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={async () => {
              try { await navigator.clipboard.writeText(enrollment.key); setCopyLabel("Copied"); }
              catch { setCopyLabel("Select and copy the key"); }
            }}>{copyLabel}</Button>
            <Button variant="contained" onClick={() => setEnrollment(null)}>Done</Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}

function Editor({ title, onSave, onClose, children }: {
  title: string;
  onSave: () => Promise<void>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog open fullWidth maxWidth="xs" onClose={busy ? undefined : onClose}>
      <Box component="form" onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try { await onSave(); }
        catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
      }}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.75 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {children}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>Save</Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function ProbeForm({ probe, companies, onClose, onSave }: {
  probe: ManagedProbe | null;
  companies: ManagedCompany[];
  onClose: () => void;
  onSave: (values: { name: string; site: string; companyId: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState(probe?.name ?? "");
  const [site, setSite] = useState(probe?.site ?? "");
  const [companyId, setCompanyId] = useState(probe?.companyId ?? "none");
  return (
    <Editor title={probe ? "Edit probe" : "New probe"} onClose={onClose} onSave={() => onSave({ name, site, companyId: companyId === "none" ? null : companyId })}>
      <TextField autoFocus required label="Probe name" value={name} onChange={(event) => setName(event.target.value)} />
      <TextField required label="Site" value={site} onChange={(event) => setSite(event.target.value)} />
      <TextField select label="Default company" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
        <MenuItem value="none">Unassigned</MenuItem>
        {companies.map((row) => <MenuItem key={row.id} value={row.id}>{row.name}</MenuItem>)}
      </TextField>
    </Editor>
  );
}

function CompanyForm({ company, onClose, onSave }: {
  company: ManagedCompany | null;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(company?.name ?? "");
  return (
    <Editor title={company ? "Edit company" : "New company"} onClose={onClose} onSave={() => onSave(name)}>
      <TextField autoFocus required label="Company name" value={name} onChange={(event) => setName(event.target.value)} />
    </Editor>
  );
}

function DeviceCompanyForm({ device, companies, onClose, onSave }: {
  device: ManagedDevice;
  companies: ManagedCompany[];
  onClose: () => void;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(device.companyOverride ? device.companyId ?? "none" : "inherit");
  return (
    <Editor title="Assign device company" onClose={onClose} onSave={() => onSave(value)}>
      <TextField select label="Company" value={value} onChange={(event) => setValue(event.target.value)}>
        <MenuItem value="inherit">Inherit from probe</MenuItem>
        <MenuItem value="none">Unassigned</MenuItem>
        {companies.map((row) => <MenuItem key={row.id} value={row.id}>{row.name}</MenuItem>)}
      </TextField>
    </Editor>
  );
}
