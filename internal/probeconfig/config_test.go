package probeconfig

import (
	"path/filepath"
	"testing"
	"time"
)

func TestSaveLoadRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "probe.json")
	want := Config{
		CIDR:          "192.168.1.0/24",
		AnchorDeskURL: "https://rmm.example.com",
		ProbeKey:      "probe-key",
		Interval:      "2m",
	}

	if err := Save(path, want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if got.Version != Version {
		t.Errorf("version = %d, want %d", got.Version, Version)
	}
	if got.CIDR != want.CIDR || got.AnchorDeskURL != want.AnchorDeskURL || got.ProbeKey != want.ProbeKey || got.Interval != want.Interval {
		t.Errorf("loaded config = %#v, want %#v", got, want)
	}
}

func TestIntervalDefaultsToOneMinute(t *testing.T) {
	cfg := Config{
		CIDR:          "192.168.1.0/24",
		AnchorDeskURL: "https://rmm.example.com",
		ProbeKey:      "probe-key",
	}

	normalized, err := cfg.Normalized()
	if err != nil {
		t.Fatalf("Normalized: %v", err)
	}
	interval, err := normalized.IntervalDuration()
	if err != nil {
		t.Fatalf("IntervalDuration: %v", err)
	}
	if interval != time.Minute {
		t.Errorf("interval = %s, want 1m", interval)
	}
}
