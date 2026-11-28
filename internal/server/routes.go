package server

import (
	"encoding/json"
	"net/http"
)

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.healthz)
	s.mux.HandleFunc("GET /api/version", s.versionHandler)
	s.mux.HandleFunc("GET /api/state", s.state)
	s.mux.HandleFunc("GET /api/scans", s.scans)
	s.mux.HandleFunc("GET /api/v1/inventory", s.exportInventory)
	s.mux.HandleFunc("GET /api/management", s.managementInventory)
	s.mux.HandleFunc("POST /api/management/companies", s.saveCompany)
	s.mux.HandleFunc("PUT /api/management/companies/{id}", s.saveCompany)
	s.mux.HandleFunc("POST /api/management/probes", s.saveProbe)
	s.mux.HandleFunc("PUT /api/management/probes/{id}", s.saveProbe)
	s.mux.HandleFunc("POST /api/management/probes/{id}/rotate-key", s.rotateProbeKey)
	s.mux.HandleFunc("PUT /api/management/devices/{id}/company", s.assignDevice)
	s.mux.HandleFunc("POST /probe/devices", s.probeDevices)
	s.mux.HandleFunc("POST /probe/heartbeat", s.probeHeartbeat)
	s.mux.HandleFunc("GET /auth/login", s.authLogin)
	s.mux.HandleFunc("GET /auth/callback", s.authCallback)
	s.mux.HandleFunc("GET /auth/logout", s.authLogout)
	s.mux.HandleFunc("POST /auth/logout", s.authLogout)
	s.mux.HandleFunc("GET /api/me", s.me)
	s.mux.Handle("GET /", s.webHandler())
}

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) versionHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"version": s.version})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
