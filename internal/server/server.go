// Package server implements the NetViz console and probe ingest. Managed
// probes report through v1, while the console stores site assignments,
// per-probe scan histories, and a separate inventory export.
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
// IngestKey is the legacy shared key. Managed probe keys live in the store.
// InventoryKey enables the separate read-only export. OIDC puts the console
// and its management API behind sign-in.
type Config struct {
	Store        *storage.SQLiteStore
	IngestKey    string
	InventoryKey string
	Version      string
	OIDC         OIDCConfig
}

// ProbeStatus is the last heartbeat the server has seen, held in memory.
type ProbeStatus struct {
	LastSeen time.Time `json:"last_seen"`
	Version  string    `json:"version,omitempty"`
	CIDR     string    `json:"cidr,omitempty"`
	Status   string    `json:"status,omitempty"`
}

type Server struct {
	mux          *http.ServeMux
	store        *storage.SQLiteStore
	ingestKey    string
	inventoryKey string
	version      string
	auth         *authenticator

	mu    sync.Mutex
	probe *ProbeStatus
}

func New(cfg Config) *Server {
	s := &Server{
		mux:          http.NewServeMux(),
		store:        cfg.Store,
		ingestKey:    cfg.IngestKey,
		inventoryKey: cfg.InventoryKey,
		version:      cfg.Version,
		auth:         newAuthenticator(cfg.OIDC),
	}
	s.routes()
	return s
}

// AuthEnabled reports whether web sign-in is configured.
func (s *Server) AuthEnabled() bool {
	return s.auth.enabled()
}

func (s *Server) Handler() http.Handler {
	return s.withAuth(s.mux)
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
