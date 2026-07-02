package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Spillers-Technology/netviz/internal/anchordesk"
	"github.com/Spillers-Technology/netviz/internal/probeconfig"
)

type fakeSender struct {
	calls     [][]anchordesk.DeviceRecord
	responses []anchordesk.IngestResult
	errors    []error
}

func (f *fakeSender) SendDevices(_ context.Context, records []anchordesk.DeviceRecord) (anchordesk.IngestResult, error) {
	copied := append([]anchordesk.DeviceRecord(nil), records...)
	f.calls = append(f.calls, copied)
	index := len(f.calls) - 1
	return f.responses[index], f.errors[index]
}

func TestDeliveryRetriesHeldRecordsAndResetsBackoff(t *testing.T) {
	t.Parallel()

	sender := &fakeSender{
		responses: []anchordesk.IngestResult{
			{},
			{Received: 2, Created: 1, Updated: 1},
		},
		errors: []error{
			errors.New("backend unavailable"),
			nil,
		},
	}
	state := &deliveryState{}

	_, sent, err := state.send(context.Background(), sender, []anchordesk.DeviceRecord{
		{ID: "device-a", Hostname: "old-name"},
	})
	if err == nil {
		t.Fatal("first send error = nil, want failure")
	}
	if sent != 1 || len(state.pending) != 1 {
		t.Fatalf("first send held %d records, pending=%d", sent, len(state.pending))
	}
	if state.backoff != retryBaseDelay {
		t.Errorf("backoff = %s, want %s", state.backoff, retryBaseDelay)
	}

	result, sent, err := state.send(context.Background(), sender, []anchordesk.DeviceRecord{
		{ID: "device-a", Hostname: "new-name"},
		{ID: "device-b"},
	})
	if err != nil {
		t.Fatalf("second send: %v", err)
	}
	if sent != 2 || result.Created != 1 || result.Updated != 1 {
		t.Errorf("second result = %#v, sent=%d", result, sent)
	}
	if len(sender.calls[1]) != 2 {
		t.Fatalf("second request records = %#v, want 2 merged records", sender.calls[1])
	}
	if sender.calls[1][0].Hostname != "new-name" {
		t.Errorf("fresh record did not replace held record: %#v", sender.calls[1][0])
	}
	if state.pending != nil || state.backoff != 0 {
		t.Errorf("delivery state not reset: pending=%#v backoff=%s", state.pending, state.backoff)
	}
}

func TestNextBackoffCapsAtMaximum(t *testing.T) {
	t.Parallel()

	if got := nextBackoff(0); got != retryBaseDelay {
		t.Errorf("first backoff = %s, want %s", got, retryBaseDelay)
	}
	if got := nextBackoff(retryMaxDelay); got != retryMaxDelay {
		t.Errorf("capped backoff = %s, want %s", got, retryMaxDelay)
	}
}

func TestServiceDefinitionKeepsSecretOutOfArguments(t *testing.T) {
	t.Parallel()

	cfg := probeConfig{
		cidr:     "192.168.1.0/24",
		url:      "https://rmm.example.com",
		key:      "super-secret-key",
		interval: 90 * time.Second,
	}
	definition := serviceDefinition(cfg)
	arguments := strings.Join(definition.Arguments, " ")
	if strings.Contains(arguments, cfg.key) || strings.Contains(arguments, cfg.url) {
		t.Errorf("service arguments expose credentials: %q", arguments)
	}
	if got := definition.EnvVars[envKey]; got != cfg.key {
		t.Errorf("%s = %q, want configured key", envKey, got)
	}
	if got := definition.EnvVars[envURL]; got != cfg.url {
		t.Errorf("%s = %q, want configured URL", envURL, got)
	}
	if !strings.Contains(arguments, cfg.cidr) || !strings.Contains(arguments, cfg.interval.String()) {
		t.Errorf("service arguments missing scan configuration: %q", arguments)
	}
}

func TestServiceDefinitionCanUseConfigFile(t *testing.T) {
	t.Parallel()

	cfg := probeConfig{
		config: filepath.Join("C:", "ProgramData", "NetViz", "probe.json"),
	}
	definition := serviceDefinition(cfg)
	arguments := strings.Join(definition.Arguments, " ")

	if !strings.Contains(arguments, "run") || !strings.Contains(arguments, "-config="+cfg.config) {
		t.Fatalf("service arguments = %q, want run -config", arguments)
	}
	if definition.EnvVars != nil {
		t.Fatalf("service env vars = %#v, want none when using config file", definition.EnvVars)
	}
}

func TestParseProbeConfigUsesEnvironment(t *testing.T) {
	t.Setenv(envURL, "https://rmm.example.com")
	t.Setenv(envKey, "probe-key")

	cfg, err := parseProbeConfig("run", []string{"-cidr", "10.20.30.0/24", "-interval", "2m"})
	if err != nil {
		t.Fatalf("parseProbeConfig: %v", err)
	}
	if cfg.url != "https://rmm.example.com" || cfg.key != "probe-key" {
		t.Errorf("environment config = %#v", cfg)
	}
	if cfg.interval != 2*time.Minute {
		t.Errorf("interval = %s, want 2m", cfg.interval)
	}
}

func TestParseProbeConfigUsesConfigFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "probe.json")
	if err := probeconfig.Save(path, probeconfig.Config{
		CIDR:          "10.20.30.0/24",
		AnchorDeskURL: "https://rmm.example.com",
		ProbeKey:      "probe-key",
		Interval:      "2m",
	}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	cfg, err := parseProbeConfig("run", []string{"-config", path})
	if err != nil {
		t.Fatalf("parseProbeConfig: %v", err)
	}
	if cfg.cidr != "10.20.30.0/24" || cfg.url != "https://rmm.example.com" || cfg.key != "probe-key" {
		t.Errorf("config file values = %#v", cfg)
	}
	if cfg.interval != 2*time.Minute {
		t.Errorf("interval = %s, want 2m", cfg.interval)
	}
}

func TestRunProbeOnceReturnsPushFailure(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"Invalid probe key"}`, http.StatusUnauthorized)
	}))
	defer server.Close()

	err := runProbe(context.Background(), probeConfig{
		cidr:     "127.0.0.1/32",
		url:      server.URL,
		key:      "bad-key",
		interval: time.Minute,
		once:     true,
	}, func(string, ...any) {})
	if err == nil {
		t.Fatal("runProbe error = nil, want rejected push")
	}
	if !strings.Contains(err.Error(), "401 Unauthorized") || !strings.Contains(err.Error(), "Invalid probe key") {
		t.Errorf("error = %q, want useful backend rejection", err)
	}
}

func TestHeartbeatLoopLogsSuccessfulReport(t *testing.T) {
	t.Parallel()

	requested := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/probe/heartbeat" {
			t.Errorf("path = %q, want /probe/heartbeat", r.URL.Path)
		}
		requested <- struct{}{}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	logged := make(chan string, 1)
	go heartbeatLoop(
		ctx,
		anchordesk.NewClient(server.URL, "probe-key", Version),
		"10.0.0.0/24",
		time.Hour,
		func(format string, args ...any) {
			logged <- fmt.Sprintf(format, args...)
		},
	)

	select {
	case <-requested:
	case <-time.After(2 * time.Second):
		t.Fatal("heartbeat request timed out")
	}
	select {
	case message := <-logged:
		if !strings.Contains(message, "heartbeat sent") || !strings.Contains(message, Version) {
			t.Errorf("log = %q, want successful heartbeat details", message)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("heartbeat log timed out")
	}
	cancel()
}
