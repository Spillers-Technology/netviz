package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/Spillers-Technology/netviz/internal/model"
)

func TestPruneScanRuns(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "netviz.db"))
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer store.Close()

	start := time.Now().UTC()
	for i, id := range []string{"oldest", "middle", "newest"} {
		run := model.ScanRun{ID: id, CIDR: "192.168.1.0/24", StartedAt: start.Add(time.Duration(i) * time.Minute)}
		hosts := []model.HostObservation{host("192.168.1.10", id+".local", true, "web_device", 80)}
		if err := store.SaveScanRun(ctx, run, hosts); err != nil {
			t.Fatalf("SaveScanRun %s: %v", id, err)
		}
	}

	removed, err := store.PruneScanRuns(ctx, 2)
	if err != nil {
		t.Fatalf("PruneScanRuns: %v", err)
	}
	if removed != 1 {
		t.Fatalf("removed %d runs, want 1", removed)
	}

	runs, err := store.ListScanRuns(ctx, 10)
	if err != nil {
		t.Fatalf("ListScanRuns: %v", err)
	}
	if len(runs) != 2 || runs[0].ID != "newest" || runs[1].ID != "middle" {
		t.Fatalf("unexpected surviving runs: %#v", runs)
	}

	if hosts, err := store.HostsForRun(ctx, "oldest"); err != nil || len(hosts) != 0 {
		t.Fatalf("pruned run observations: hosts=%v err=%v, want none", hosts, err)
	}
	if hosts, err := store.HostsForRun(ctx, "newest"); err != nil || len(hosts) != 1 {
		t.Fatalf("kept run observations: hosts=%v err=%v, want 1", hosts, err)
	}
}

func TestSQLiteStoreSaveListAndDiff(t *testing.T) {
	ctx := context.Background()
	store, err := OpenSQLite(filepath.Join(t.TempDir(), "netviz.db"))
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	defer store.Close()

	start := time.Now().UTC()
	base := model.ScanRun{ID: "base", CIDR: "192.168.1.0/24", StartedAt: start}
	compare := model.ScanRun{ID: "compare", CIDR: "192.168.1.0/24", StartedAt: start.Add(time.Minute)}

	baseHosts := []model.HostObservation{
		host("192.168.1.10", "old.local", true, "ssh_device", 22),
		host("192.168.1.11", "gone.local", true, "web_device", 80),
	}
	compareHosts := []model.HostObservation{
		host("192.168.1.10", "new.local", true, "web_device", 80, 443),
		host("192.168.1.12", "fresh.local", true, "printer", 9100),
	}

	if err := store.SaveScanRun(ctx, base, baseHosts); err != nil {
		t.Fatalf("SaveScanRun base: %v", err)
	}
	if err := store.SaveScanRun(ctx, compare, compareHosts); err != nil {
		t.Fatalf("SaveScanRun compare: %v", err)
	}

	runs, err := store.ListScanRuns(ctx, 10)
	if err != nil {
		t.Fatalf("ListScanRuns: %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("got %d runs, want 2", len(runs))
	}
	if runs[0].ID != "compare" || runs[0].HostCount != 2 || runs[0].OpenPortCount != 3 {
		t.Fatalf("unexpected newest run: %#v", runs[0])
	}

	diff, err := store.DiffRuns(ctx, "base", "compare")
	if err != nil {
		t.Fatalf("DiffRuns: %v", err)
	}
	if len(diff.NewHosts) != 1 || diff.NewHosts[0].IP != "192.168.1.12" {
		t.Fatalf("unexpected new hosts: %#v", diff.NewHosts)
	}
	if len(diff.MissingHosts) != 1 || diff.MissingHosts[0].IP != "192.168.1.11" {
		t.Fatalf("unexpected missing hosts: %#v", diff.MissingHosts)
	}
	if len(diff.ChangedHosts) != 1 || !diff.ChangedHosts[0].HostnameChanged || !diff.ChangedHosts[0].PortsChanged {
		t.Fatalf("unexpected changed hosts: %#v", diff.ChangedHosts)
	}
}

func host(ip string, hostname string, alive bool, deviceType string, ports ...int) model.HostObservation {
	now := time.Now().UTC()
	openPorts := make([]model.PortObservation, 0, len(ports))
	for _, port := range ports {
		openPorts = append(openPorts, model.PortObservation{Port: port, Service: "tcp"})
	}
	return model.HostObservation{
		IP:         ip,
		Hostname:   hostname,
		Alive:      alive,
		OpenPorts:  openPorts,
		DeviceType: deviceType,
		FirstSeen:  now,
		LastUpdate: now,
	}
}
