package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFinalizeUpdateSwapsAndBacksUp(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "netviz.exe")
	self := filepath.Join(dir, "netviz.exe.new")
	if err := os.WriteFile(target, []byte("old-version"), 0o755); err != nil {
		t.Fatalf("write target: %v", err)
	}
	if err := os.WriteFile(self, []byte("new-version"), 0o755); err != nil {
		t.Fatalf("write staged: %v", err)
	}

	if err := finalizeUpdate(self, target, time.Second); err != nil {
		t.Fatalf("finalizeUpdate: %v", err)
	}

	installed, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read installed: %v", err)
	}
	if string(installed) != "new-version" {
		t.Fatalf("installed content = %q, want new version", installed)
	}
	backup, err := os.ReadFile(target + ".old")
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if string(backup) != "old-version" {
		t.Fatalf("backup content = %q, want old version", backup)
	}
}

func TestFinalizeUpdateRecoversMissingTarget(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "netviz.exe")
	self := filepath.Join(dir, "netviz.exe.new")
	if err := os.WriteFile(self, []byte("new-version"), 0o755); err != nil {
		t.Fatalf("write staged: %v", err)
	}

	// A half-finished previous swap can leave the target missing; the
	// finalizer installs into the free slot instead of failing.
	if err := finalizeUpdate(self, target, time.Second); err != nil {
		t.Fatalf("finalizeUpdate with missing target: %v", err)
	}
	installed, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read installed: %v", err)
	}
	if string(installed) != "new-version" {
		t.Fatalf("installed content = %q, want new version", installed)
	}
}

func TestCleanupAfterUpdateRemovesLeftovers(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Skipf("os.Executable: %v", err)
	}
	// Only exercise cleanup when we can write next to the test binary.
	for _, suffix := range []string{".old", ".new"} {
		if err := os.WriteFile(executable+suffix, []byte("leftover"), 0o600); err != nil {
			t.Skipf("cannot create leftover next to test binary: %v", err)
		}
	}
	cleanupAfterUpdate()
	for _, suffix := range []string{".old", ".new"} {
		if _, err := os.Stat(executable + suffix); !os.IsNotExist(err) {
			t.Fatalf("leftover %s still exists after cleanup", suffix)
		}
	}
}
