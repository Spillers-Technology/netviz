package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/Spillers-Technology/netviz/internal/server"
	"github.com/Spillers-Technology/netviz/internal/storage"
	"github.com/Spillers-Technology/netviz/internal/version"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	dbPath := flag.String("db", "netviz-server.db", "SQLite database path")
	ingestKey := flag.String("ingest-key", "", "probe API key required on X-Probe-Key (falls back to NETVIZ_INGEST_KEY; ingest is disabled when unset)")
	flag.Parse()

	key := *ingestKey
	if key == "" {
		key = os.Getenv("NETVIZ_INGEST_KEY")
	}
	if key == "" {
		log.Println("warning: no ingest key configured; probe endpoints will answer 503 until -ingest-key or NETVIZ_INGEST_KEY is set")
	}

	store, err := storage.OpenSQLite(*dbPath)
	if err != nil {
		return fmt.Errorf("open storage: %w", err)
	}
	defer store.Close()

	srv := server.New(server.Config{
		Store:     store,
		IngestKey: key,
		Version:   version.Version,
	})
	log.Printf("netviz-server %s listening on %s (db %s)", version.Version, *addr, *dbPath)
	err = srv.ListenAndServe(*addr)
	if err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}
