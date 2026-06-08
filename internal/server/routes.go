package server

import (
	"encoding/json"
	"net/http"
)

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.healthz)
	s.mux.HandleFunc("GET /api/version", s.version)
	s.mux.HandleFunc("GET /api/scans", s.scans)
	s.mux.HandleFunc("GET /", s.index)
}

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) version(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"version": Version})
}

func (s *Server) scans(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"scans": []any{},
		"note":  "server ingest is planned for v0.1.5",
	})
}

func (s *Server) index(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NetViz Server</title>
  <style>
    body { font-family: "Segoe UI", system-ui, sans-serif; margin: 0; color: #202020; background: #f7f7f7; }
    main { max-width: 760px; margin: 12vh auto; padding: 0 24px; }
    h1 { font-size: 42px; margin: 0 0 12px; }
    p { font-size: 17px; line-height: 1.55; }
    code { background: #ededed; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <h1>NetViz Server</h1>
    <p>Server/probe mode is planned for v0.1.5. This container currently exposes health, version, and placeholder scan APIs.</p>
    <p>Try <code>/healthz</code>, <code>/api/version</code>, or <code>/api/scans</code>.</p>
  </main>
</body>
</html>`))
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
