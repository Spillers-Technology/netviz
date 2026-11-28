package server

import (
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Spillers-Technology/netviz/internal/anchordesk"
	"github.com/Spillers-Technology/netviz/internal/model"
	"github.com/Spillers-Technology/netviz/internal/storage"
)

// maxIngestBody bounds a device push. A /16 of fully described devices fits
// comfortably; anything larger is a misbehaving client.
const maxIngestBody = 16 << 20

type devicesRequest struct {
	Devices []anchordesk.DeviceRecord `json:"devices"`
}

type heartbeatRequest struct {
	Status  string `json:"status"`
	Version string `json:"version"`
	CIDR    string `json:"cidr"`
}

// probeDevices accepts a v1 probe device batch, stores it as a scan run, and
// reports created/updated counts against the previous run so the probe's
// upsert semantics hold: re-pushing a known device is an update, not a
// duplicate.
func (s *Server) probeDevices(w http.ResponseWriter, r *http.Request) {
	probe, ok := s.authorize(w, r)
	if !ok {
		return
	}
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, "storage is not configured")
		return
	}

	var req devicesRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxIngestBody))
	if err := decoder.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid device payload: "+err.Error())
		return
	}

	now := time.Now().UTC()
	if probe != nil {
		for i := range req.Devices {
			if req.Devices[i].LastSeen.IsZero() {
				req.Devices[i].LastSeen = now
			}
			if req.Devices[i].FirstSeen.IsZero() {
				req.Devices[i].FirstSeen = req.Devices[i].LastSeen
			}
		}
	}
	hosts := anchordesk.FromDeviceRecords(req.Devices)
	run := model.ScanRun{
		ID:        newRunID(),
		CIDR:      s.runCIDR(),
		StartedAt: now,
		EndedAt:   now,
	}
	var created, updated int
	var err error
	if probe != nil {
		if probe.CIDR != "" {
			run.CIDR = probe.CIDR
		} else {
			run.CIDR = probe.Site
		}
		devices, validation := managedDeviceObservations(probe.ID, req.Devices)
		if validation != nil {
			writeError(w, http.StatusBadRequest, validation.Error())
			return
		}
		created, err = s.store.SaveManagedRun(r.Context(), probe.ID, run, hosts, devices)
		updated = len(devices) - created
	} else {
		created, updated = s.countTransitions(r, hosts)
		err = s.store.SaveScanRun(r.Context(), run, hosts)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save scan run")
		return
	}
	if _, err := s.store.PruneScanRuns(r.Context(), maxRunsKept); err != nil {
		writeError(w, http.StatusInternalServerError, "prune scan runs: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, anchordesk.IngestResult{
		Received: len(req.Devices),
		Created:  created,
		Updated:  updated,
		Errors:   []string{},
	})
}

func (s *Server) probeHeartbeat(w http.ResponseWriter, r *http.Request) {
	probe, ok := s.authorize(w, r)
	if !ok {
		return
	}

	var req heartbeatRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := decoder.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid heartbeat payload: "+err.Error())
		return
	}

	if probe != nil {
		if len(req.Version) > 50 || len(req.CIDR) > 100 {
			writeError(w, http.StatusBadRequest, "probe version or network is too long")
			return
		}
		if req.Status == "" {
			req.Status = "online"
		}
		if err := s.store.ManagedHeartbeat(r.Context(), probe.ID, req.Status, req.Version, req.CIDR, time.Now().UTC()); err != nil {
			writeError(w, http.StatusInternalServerError, "could not save probe heartbeat")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}

	s.setProbeStatus(ProbeStatus{
		LastSeen: time.Now().UTC(),
		Version:  req.Version,
		CIDR:     req.CIDR,
		Status:   req.Status,
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// authorize keeps the deployment-wide key for existing probes during migration.
func (s *Server) authorize(w http.ResponseWriter, r *http.Request) (*storage.ManagedProbe, bool) {
	key := r.Header.Get("X-Probe-Key")
	if key != "" && s.ingestKey != "" && subtle.ConstantTimeCompare([]byte(key), []byte(s.ingestKey)) == 1 {
		return nil, true
	}
	if strings.HasPrefix(key, "nv_probe_") && s.store != nil {
		probe, err := s.store.ManagedProbeByKey(r.Context(), key)
		if err == nil {
			return &probe, true
		}
		if !errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusInternalServerError, "could not verify probe")
			return nil, false
		}
	}
	if s.ingestKey == "" && key == "" {
		writeError(w, http.StatusServiceUnavailable, "probe ingest key is required")
		return nil, false
	}
	writeError(w, http.StatusUnauthorized, "invalid probe key")
	return nil, false
}

// countTransitions classifies incoming hosts as created or updated against
// the latest stored run, keyed the same way the contract keys devices
// (mac, falling back to ip).
func (s *Server) countTransitions(r *http.Request, hosts []model.HostObservation) (created int, updated int) {
	known := make(map[string]bool)
	if runs, err := s.store.ListProbeRuns(r.Context(), "legacy", 1); err == nil && len(runs) == 1 {
		if previous, err := s.store.HostsForRun(r.Context(), runs[0].ID); err == nil {
			for _, host := range previous {
				known[hostKey(host)] = true
			}
		}
	}
	for _, host := range hosts {
		if known[hostKey(host)] {
			updated++
		} else {
			created++
		}
	}
	return created, updated
}

func hostKey(h model.HostObservation) string {
	if h.MACAddress != "" {
		return "mac:" + h.MACAddress
	}
	return "ip:" + h.IP
}

// runCIDR labels stored runs with the CIDR from the latest heartbeat; the
// device push itself does not carry one on the v1 wire.
func (s *Server) runCIDR() string {
	if probe := s.probeStatus(); probe != nil && probe.CIDR != "" {
		return probe.CIDR
	}
	return "probe"
}

func newRunID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "run-" + time.Now().UTC().Format("20060102T150405.000000000")
	}
	return hex.EncodeToString(buf)
}
