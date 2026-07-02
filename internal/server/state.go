package server

import (
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

	runs, err := s.store.ListScanRuns(r.Context(), 1)
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
	runs, err := s.store.ListScanRuns(r.Context(), 20)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list scan runs: "+err.Error())
		return
	}
	if runs == nil {
		runs = []model.ScanRun{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"scans": runs})
}
