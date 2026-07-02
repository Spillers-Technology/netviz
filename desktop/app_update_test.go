package main

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	t.Parallel()

	tests := []struct {
		left  string
		right string
		want  int
	}{
		{left: "v0.1.1", right: "0.1.0", want: 1},
		{left: "0.1.0", right: "v0.1.0", want: 0},
		{left: "0.1.0-beta.1", right: "0.1.0", want: 0},
		{left: "0.0.9", right: "0.1.0", want: -1},
	}
	for _, tt := range tests {
		if got := compareVersions(tt.left, tt.right); got != tt.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", tt.left, tt.right, got, tt.want)
		}
	}
}

func TestCheckForUpdateSelectsPlatformAssetAndChecksum(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"tag_name": "v9.9.9",
			"html_url": "https://github.com/Spillers-Technology/netviz/releases/tag/v9.9.9",
			"assets": [
				{"name": "` + expectedUpdateAssetName("v9.9.9") + `", "browser_download_url": "https://example.com/update"},
				{"name": "` + expectedUpdateAssetName("v9.9.9") + `.sha256", "browser_download_url": "https://example.com/update.sha256"}
			]
		}`))
	}))
	defer server.Close()

	info, err := checkForUpdateURL(t.Context(), http.DefaultClient, server.URL)
	if err != nil {
		t.Fatalf("checkForUpdateURL: %v", err)
	}
	if !info.Available {
		t.Fatalf("available = false, message=%q", info.Message)
	}
	if info.AssetName != expectedUpdateAssetName("v9.9.9") {
		t.Fatalf("asset = %q", info.AssetName)
	}
	if info.ChecksumURL == "" {
		t.Fatal("checksum URL was not selected")
	}
}

func TestVerifySHA256(t *testing.T) {
	path := filepath.Join(t.TempDir(), "asset.zip")
	content := []byte("netviz update")
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(content)

	if err := verifySHA256(path, hex.EncodeToString(sum[:])); err != nil {
		t.Fatalf("verifySHA256: %v", err)
	}
	if err := verifySHA256(path, "0000000000000000000000000000000000000000000000000000000000000000"); err == nil {
		t.Fatal("verifySHA256 mismatch error = nil")
	}
}
