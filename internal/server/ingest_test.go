package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Spillers-Technology/netviz/internal/anchordesk"
	"github.com/Spillers-Technology/netviz/internal/model"
	"github.com/Spillers-Technology/netviz/internal/storage"
)

func newTestServer(t *testing.T, key string) (*httptest.Server, *storage.SQLiteStore) {
	t.Helper()
	store, err := storage.OpenSQLite(filepath.Join(t.TempDir(), "server.db"))
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	srv := New(Config{Store: store, IngestKey: key, Version: "test"})
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts, store
}

func testHosts() []model.HostObservation {
	return []model.HostObservation{
		{
			IP:         "192.168.1.10",
			Hostname:   "printer.lan",
			MACAddress: "aa:bb:cc:dd:ee:01",
			Vendor:     "HP",
			Alive:      true,
			DeviceType: "printer",
			OpenPorts:  []model.PortObservation{{Port: 9100, Service: "jetdirect"}},
		},
		{
			IP:         "192.168.1.20",
			Hostname:   "nas.lan",
			MACAddress: "aa:bb:cc:dd:ee:02",
			Vendor:     "Synology",
			Alive:      true,
			DeviceType: "linux_or_iot",
			OpenPorts:  []model.PortObservation{{Port: 22, Service: "ssh"}, {Port: 445, Service: "smb"}},
		},
	}
}

// TestProbeClientAgainstServer drives the real anchordesk probe client against
// the server: first push creates, re-push updates with no duplicates, and the
// heartbeat surfaces in /api/state. This is the v1 contract meeting in the
// middle inside one test.
func TestProbeClientAgainstServer(t *testing.T) {
	ts, store := newTestServer(t, "secret-key")
	client := anchordesk.NewClient(ts.URL, "secret-key", "test-probe")
	ctx := context.Background()

	if err := client.Heartbeat(ctx, "ok", "192.168.1.0/24"); err != nil {
		t.Fatalf("Heartbeat: %v", err)
	}

	first, err := client.SendDevices(ctx, anchordesk.ToDeviceRecords(testHosts()))
	if err != nil {
		t.Fatalf("SendDevices first push: %v", err)
	}
	if first.Received != 2 || first.Created != 2 || first.Updated != 0 {
		t.Fatalf("first push: got %+v, want received 2 created 2 updated 0", first)
	}

	second, err := client.SendDevices(ctx, anchordesk.ToDeviceRecords(testHosts()))
	if err != nil {
		t.Fatalf("SendDevices second push: %v", err)
	}
	if second.Received != 2 || second.Created != 0 || second.Updated != 2 {
		t.Fatalf("second push: got %+v, want received 2 created 0 updated 2", second)
	}

	runs, err := store.ListScanRuns(ctx, 10)
	if err != nil {
		t.Fatalf("ListScanRuns: %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("stored runs: got %d, want 2", len(runs))
	}
	if runs[0].CIDR != "192.168.1.0/24" {
		t.Fatalf("run CIDR: got %q, want heartbeat CIDR", runs[0].CIDR)
	}

	hosts, err := store.HostsForRun(ctx, runs[0].ID)
	if err != nil {
		t.Fatalf("HostsForRun: %v", err)
	}
	if len(hosts) != 2 {
		t.Fatalf("hosts in latest run: got %d, want 2 (no duplicates)", len(hosts))
	}

	resp, err := http.Get(ts.URL + "/api/state")
	if err != nil {
		t.Fatalf("GET /api/state: %v", err)
	}
	defer resp.Body.Close()
	var state struct {
		Version string                  `json:"version"`
		Probe   *ProbeStatus            `json:"probe"`
		Run     *model.ScanRun          `json:"run"`
		Devices []model.HostObservation `json:"devices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&state); err != nil {
		t.Fatalf("decode state: %v", err)
	}
	if state.Probe == nil || state.Probe.CIDR != "192.168.1.0/24" || state.Probe.Version != "test-probe" {
		t.Fatalf("state probe: got %+v, want heartbeat data", state.Probe)
	}
	if state.Run == nil || len(state.Devices) != 2 {
		t.Fatalf("state: got run %v with %d devices, want latest run with 2 devices", state.Run, len(state.Devices))
	}
	if state.Devices[0].OpenPorts[0].Port != 9100 {
		t.Fatalf("device ports: got %+v, want port 9100 first", state.Devices[0].OpenPorts)
	}
}

func TestIngestRejectsBadKey(t *testing.T) {
	ts, _ := newTestServer(t, "secret-key")

	for _, path := range []string{"/probe/devices", "/probe/heartbeat"} {
		resp, err := http.Post(ts.URL+path, "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("POST %s: %v", path, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("POST %s without key: got status %d, want 401", path, resp.StatusCode)
		}
	}

	client := anchordesk.NewClient(ts.URL, "wrong-key", "test-probe")
	if _, err := client.SendDevices(context.Background(), nil); err == nil {
		t.Fatal("SendDevices with wrong key: want error, got nil")
	}
}

func TestIngestDisabledWithoutKey(t *testing.T) {
	ts, _ := newTestServer(t, "")

	resp, err := http.Post(ts.URL+"/probe/devices", "application/json", strings.NewReader(`{"devices":[]}`))
	if err != nil {
		t.Fatalf("POST /probe/devices: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("ingest without configured key: got status %d, want 503", resp.StatusCode)
	}
}

func TestStateEmptyServer(t *testing.T) {
	ts, _ := newTestServer(t, "secret-key")

	resp, err := http.Get(ts.URL + "/api/state")
	if err != nil {
		t.Fatalf("GET /api/state: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("empty state: got status %d, want 200", resp.StatusCode)
	}
	var state stateResponse
	if err := json.NewDecoder(resp.Body).Decode(&state); err != nil {
		t.Fatalf("decode state: %v", err)
	}
	if state.Run != nil || len(state.Devices) != 0 || state.Probe != nil {
		t.Fatalf("empty state: got %+v, want no run, no probe, empty devices", state)
	}
}
