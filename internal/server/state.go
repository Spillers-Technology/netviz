package server

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/Spillers-Technology/netviz/internal/model"
)

type stateResponse struct {
	Version string                  `json:"version"`
	Probe   *ProbeStatus            `json:"probe,omitempty"`
	Run     *model.ScanRun          `json:"run,omitempty"`
	Devices []model.HostObservation `json:"devices"`
}

// state returns the latest network state: the newest stored run, its host
// observations, and the last probe heartbeat. This is the web UI's data
// source and mirrors what the desktop shows after a scan.
func (s *Server) state(w http.ResponseWriter, r *http.Request) {
	response := stateResponse{Version: s.version, Devices: []model.HostObservation{}, Probe: s.probeStatus()}
	if s.store == nil {
		writeJSON(w, http.StatusOK, response)
		return
	}

	probeID := r.URL.Query().Get("probe")
	if probeID != "" && probeID != "legacy" {
		s.managedState(w, r, response, probeID)
		return
	}
	runs, err := s.store.ListProbeRuns(r.Context(), "legacy", 1)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list scan runs: "+err.Error())
		return
	}
	if len(runs) == 1 {
		run := runs[0]
		hosts, err := s.store.HostsForRun(r.Context(), run.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "load hosts: "+err.Error())
			return
		}
		response.Run = &run
		if hosts != nil {
			response.Devices = hosts
		}
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) scans(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeJSON(w, http.StatusOK, map[string]any{"scans": []any{}})
		return
	}
	var runs []model.ScanRun
	var err error
	if probeID := r.URL.Query().Get("probe"); probeID != "" {
		runs, err = s.store.ListProbeRuns(r.Context(), probeID, 20)
	} else {
		runs, err = s.store.ListScanRuns(r.Context(), 20)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list scan runs: "+err.Error())
		return
	}
	if runs == nil {
		runs = []model.ScanRun{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"scans": runs})
}

func (s *Server) managedState(w http.ResponseWriter, r *http.Request, response stateResponse, id string) {
	probe, err := s.store.ManagedProbe(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "probe not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not read probe")
		return
	}
	response.Probe = nil
	if probe.LastSeen != nil {
		response.Probe = &ProbeStatus{LastSeen: *probe.LastSeen, Version: probe.Version, CIDR: probe.CIDR, Status: probe.Status}
	}
	run, err := s.store.LatestManagedRun(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not read probe scan")
		return
	}
	if run != nil {
		response.Run = run
		hosts, err := s.store.HostsForRun(r.Context(), run.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not read probe devices")
			return
		}
		if hosts != nil {
			response.Devices = hosts
		}
	}
	writeJSON(w, http.StatusOK, response)
}
