package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/Spillers-Technology/netviz/internal/anchordesk"
	"github.com/Spillers-Technology/netviz/internal/model"
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
	if !s.authorize(w, r) {
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

	hosts := anchordesk.FromDeviceRecords(req.Devices)
	created, updated := s.countTransitions(r, hosts)

	now := time.Now().UTC()
	run := model.ScanRun{
		ID:        newRunID(),
		CIDR:      s.runCIDR(),
		StartedAt: now,
		EndedAt:   now,
	}
	if err := s.store.SaveScanRun(r.Context(), run, hosts); err != nil {
		writeError(w, http.StatusInternalServerError, "save scan run: "+err.Error())
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
	if !s.authorize(w, r) {
		return
	}

	var req heartbeatRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := decoder.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid heartbeat payload: "+err.Error())
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

// authorize enforces the probe key. Ingest is deny-by-default: without a
// configured key the endpoints answer 503 so an unauthenticated server is
// never silently open.
func (s *Server) authorize(w http.ResponseWriter, r *http.Request) bool {
	if s.ingestKey == "" {
		writeError(w, http.StatusServiceUnavailable, "probe ingest key is not configured on this server")
		return false
	}
	provided := r.Header.Get("X-Probe-Key")
	if subtle.ConstantTimeCompare([]byte(provided), []byte(s.ingestKey)) != 1 {
		writeError(w, http.StatusUnauthorized, "invalid probe key")
		return false
	}
	return true
}

// countTransitions classifies incoming hosts as created or updated against
// the latest stored run, keyed the same way the contract keys devices
// (mac, falling back to ip).
func (s *Server) countTransitions(r *http.Request, hosts []model.HostObservation) (created int, updated int) {
	known := make(map[string]bool)
	if runs, err := s.store.ListScanRuns(r.Context(), 1); err == nil && len(runs) == 1 {
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
