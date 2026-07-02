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
	oidcIssuer := flag.String("oidc-issuer", "", "OIDC issuer URL for web sign-in (falls back to NETVIZ_OIDC_ISSUER; auth is disabled when unset)")
	oidcClientID := flag.String("oidc-client-id", "", "OIDC client ID (falls back to NETVIZ_OIDC_CLIENT_ID)")
	publicURL := flag.String("public-url", "", "externally visible base URL, used for the OIDC redirect URI (falls back to NETVIZ_PUBLIC_URL)")
	flag.Parse()

	key := envFallback(*ingestKey, "NETVIZ_INGEST_KEY")
	if key == "" {
		log.Println("warning: no ingest key configured; probe endpoints will answer 503 until -ingest-key or NETVIZ_INGEST_KEY is set")
	}

	oidc := server.OIDCConfig{
		Issuer:       envFallback(*oidcIssuer, "NETVIZ_OIDC_ISSUER"),
		ClientID:     envFallback(*oidcClientID, "NETVIZ_OIDC_CLIENT_ID"),
		ClientSecret: os.Getenv("NETVIZ_OIDC_CLIENT_SECRET"),
		PublicURL:    envFallback(*publicURL, "NETVIZ_PUBLIC_URL"),
	}
	if secret := os.Getenv("NETVIZ_SESSION_SECRET"); secret != "" {
		oidc.SessionSecret = []byte(secret)
	}
	if oidc.Issuer != "" {
		if oidc.ClientID == "" || oidc.PublicURL == "" {
			return fmt.Errorf("OIDC sign-in needs -oidc-client-id and -public-url alongside -oidc-issuer")
		}
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
		OIDC:      oidc,
	})
	if srv.AuthEnabled() {
		log.Printf("web sign-in enabled via OIDC issuer %s", oidc.Issuer)
	} else {
		log.Println("warning: web sign-in is DISABLED (trusted-LAN mode); set -oidc-issuer to require SSO")
	}
	log.Printf("netviz-server %s listening on %s (db %s)", version.Version, *addr, *dbPath)
	err = srv.ListenAndServe(*addr)
	if err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

func envFallback(value string, envName string) string {
	if value != "" {
		return value
	}
	return os.Getenv(envName)
}
