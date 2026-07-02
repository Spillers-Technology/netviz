// Package server implements the single-tenant netviz server: it accepts the
// same v1 probe wire contract that AnchorDesk consumes, stores each push as a
// scan run in the shared SQLite store, and serves the latest network state as
// JSON and an embedded web UI. Multi-tenancy is deliberately out of scope —
// AnchorDesk owns tenancy; a netviz server is one site.
package server

import (
	"net/http"
	"sync"
	"time"

	"github.com/Spillers-Technology/netviz/internal/storage"
)

// maxRunsKept bounds the run history a server retains. Probes push on an
// interval, so unbounded retention would grow the database forever; the
// newest runs are the ones the UI and diff endpoints read.
const maxRunsKept = 500

// Config wires a Server. Store is required for ingest and state endpoints.
// IngestKey guards the probe endpoints; when empty, ingest is disabled and
// probes receive 503 until the operator configures a key.
type Config struct {
	Store     *storage.SQLiteStore
	IngestKey string
	Version   string
}

// ProbeStatus is the last heartbeat the server has seen, held in memory.
type ProbeStatus struct {
	LastSeen time.Time `json:"last_seen"`
	Version  string    `json:"version,omitempty"`
	CIDR     string    `json:"cidr,omitempty"`
	Status   string    `json:"status,omitempty"`
}

type Server struct {
	mux       *http.ServeMux
	store     *storage.SQLiteStore
	ingestKey string
	version   string

	mu    sync.Mutex
	probe *ProbeStatus
}

func New(cfg Config) *Server {
	s := &Server{
		mux:       http.NewServeMux(),
		store:     cfg.Store,
		ingestKey: cfg.IngestKey,
		version:   cfg.Version,
	}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) ListenAndServe(addr string) error {
	server := &http.Server{
		Addr:              addr,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	return server.ListenAndServe()
}

func (s *Server) setProbeStatus(status ProbeStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.probe = &status
}

func (s *Server) probeStatus() *ProbeStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.probe == nil {
		return nil
	}
	copied := *s.probe
	return &copied
}
