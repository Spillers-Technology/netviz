package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestExtractDesktopBinaryFromZip(t *testing.T) {
	dir := t.TempDir()
	archivePath := filepath.Join(dir, "netviz-v9.9.9-windows-amd64.zip")

	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for name, body := range map[string]string{
		"bin/netviz-cli.exe": "cli",
		"netviz.exe":         "new-desktop-binary",
		"README.md":          "docs",
	} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create zip entry: %v", err)
		}
		if _, err := entry.Write([]byte(body)); err != nil {
			t.Fatalf("write zip entry: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	if err := os.WriteFile(archivePath, buf.Bytes(), 0o600); err != nil {
		t.Fatalf("write archive: %v", err)
	}

	dest := filepath.Join(dir, "netviz.exe.new")
	if err := extractDesktopBinary(archivePath, "netviz.exe", dest); err != nil {
		t.Fatalf("extractDesktopBinary: %v", err)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read extracted binary: %v", err)
	}
	if string(got) != "new-desktop-binary" {
		t.Fatalf("extracted content = %q, want the desktop binary", got)
	}
}

func TestExtractDesktopBinaryFromLegacyDesktopZip(t *testing.T) {
	dir := t.TempDir()
	archivePath := filepath.Join(dir, "netviz-v9.9.9-windows-amd64.zip")

	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for name, body := range map[string]string{
		"netviz/bin/netviz-cli.exe":     "cli",
		"netviz/desktop/netviz.exe":     "new-desktop-binary",
		"netviz/desktop/netviz-dev.exe": "dev-binary",
	} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create zip entry: %v", err)
		}
		if _, err := entry.Write([]byte(body)); err != nil {
			t.Fatalf("write zip entry: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	if err := os.WriteFile(archivePath, buf.Bytes(), 0o600); err != nil {
		t.Fatalf("write archive: %v", err)
	}

	dest := filepath.Join(dir, "netviz.exe.new")
	if err := extractDesktopBinary(archivePath, "netviz.exe", dest); err != nil {
		t.Fatalf("extractDesktopBinary: %v", err)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read extracted binary: %v", err)
	}
	if string(got) != "new-desktop-binary" {
		t.Fatalf("extracted content = %q, want the desktop binary", got)
	}
}

func TestExtractDesktopBinaryFromTarGz(t *testing.T) {
	dir := t.TempDir()
	archivePath := filepath.Join(dir, "netviz-v9.9.9-linux-amd64.tar.gz")

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range map[string]string{
		"netviz/bin/netviz-cli": "cli",
		"netviz/netviz":         "new-desktop-binary",
	} {
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Size: int64(len(body)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatalf("tar header: %v", err)
		}
		if _, err := io.WriteString(tw, body); err != nil {
			t.Fatalf("tar body: %v", err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("close tar: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("close gzip: %v", err)
	}
	if err := os.WriteFile(archivePath, buf.Bytes(), 0o600); err != nil {
		t.Fatalf("write archive: %v", err)
	}

	dest := filepath.Join(dir, "netviz.new")
	if err := extractDesktopBinary(archivePath, "netviz", dest); err != nil {
		t.Fatalf("extractDesktopBinary: %v", err)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read extracted binary: %v", err)
	}
	if string(got) != "new-desktop-binary" {
		t.Fatalf("extracted content = %q, want the desktop binary", got)
	}
}

func TestExtractDesktopBinaryMissingEntry(t *testing.T) {
	dir := t.TempDir()
	archivePath := filepath.Join(dir, "netviz-v9.9.9-windows-amd64.zip")

	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	entry, err := writer.Create("netviz/bin/netviz-cli.exe")
	if err != nil {
		t.Fatalf("create zip entry: %v", err)
	}
	if _, err := entry.Write([]byte("cli")); err != nil {
		t.Fatalf("write zip entry: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	if err := os.WriteFile(archivePath, buf.Bytes(), 0o600); err != nil {
		t.Fatalf("write archive: %v", err)
	}

	if err := extractDesktopBinary(archivePath, "netviz.exe", filepath.Join(dir, "out")); err == nil {
		t.Fatal("extractDesktopBinary: want error for archive without the desktop binary")
	}
}
