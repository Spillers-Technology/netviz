package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestValidateProbeSetupAcceptsProvisioningFields(t *testing.T) {
	req := ProbeSetupRequest{
		CIDR:              "192.168.1.0/24",
		AnchorDeskURL:     "https://rmm.example.com",
		ProbeKey:          "secret",
		Interval:          "1m",
		InstallPersistent: true,
	}

	if err := validateProbeSetup(req); err != nil {
		t.Fatalf("validateProbeSetup() error = %v", err)
	}
}

func TestValidateProbeSetupRejectsBadAnchorDeskURL(t *testing.T) {
	req := ProbeSetupRequest{
		CIDR:          "192.168.1.0/24",
		AnchorDeskURL: "rmm.example.com",
		ProbeKey:      "secret",
		Interval:      "1m",
	}

	if err := validateProbeSetup(req); err == nil {
		t.Fatal("validateProbeSetup() error = nil, want invalid URL error")
	}
}

func TestProbeCredentialsUseEnvironmentVariables(t *testing.T) {
	req := ProbeSetupRequest{
		AnchorDeskURL: "https://rmm.example.com",
		ProbeKey:      "secret-key",
	}

	env := strings.Join(probeCredentialEnv(req), "\n")
	if !strings.Contains(env, probeEnvURL+"=https://rmm.example.com") {
		t.Fatalf("env missing AnchorDesk URL: %q", env)
	}
	if !strings.Contains(env, probeEnvKey+"=secret-key") {
		t.Fatalf("env missing probe key: %q", env)
	}

	args := []string{"install", "-cidr=192.168.1.0/24", "-interval=1m"}
	if strings.Contains(strings.Join(args, " "), "secret-key") {
		t.Fatal("probe key leaked into service install arguments")
	}
}

func TestResolveProbeBinaryHonorsPreferredPath(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), probeBinaryName())
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(file.Name(), 0o755); err != nil {
		t.Fatal(err)
	}

	path, found := resolveProbeBinary(file.Name())
	if !found {
		t.Fatal("resolveProbeBinary() found = false, want true")
	}
	if path != file.Name() {
		t.Fatalf("resolveProbeBinary() path = %q, want %q", path, file.Name())
	}
}

func TestProbeInstallPathIsStandardLocation(t *testing.T) {
	path := probeInstallPath()
	if runtime.GOOS == "windows" {
		if !strings.Contains(path, filepath.Join("NetViz", "netviz-probe.exe")) || !strings.Contains(strings.ToLower(path), "program files") {
			t.Fatalf("probeInstallPath() = %q, want under Program Files\\NetViz", path)
		}
		return
	}
	if path != "/usr/local/bin/netviz-probe" {
		t.Fatalf("probeInstallPath() = %q, want /usr/local/bin/netviz-probe", path)
	}
}

func TestProbeBinaryCandidatesPreferInstallPath(t *testing.T) {
	candidates := probeBinaryCandidates()
	if len(candidates) == 0 || !samePath(candidates[0], probeInstallPath()) {
		t.Fatalf("probeBinaryCandidates()[0] = %v, want %q first", candidates, probeInstallPath())
	}
}

func TestInstallProbeBinaryCopiesExecutable(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source"+probeBinaryName())
	if err := os.WriteFile(source, []byte("probe-bytes"), 0o755); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(dir, "install", probeBinaryName())

	if err := installProbeBinary(source, dest); err != nil {
		t.Fatalf("installProbeBinary() error = %v", err)
	}
	data, err := os.ReadFile(dest)
	if err != nil || string(data) != "probe-bytes" {
		t.Fatalf("installed binary content = %q, err = %v", data, err)
	}
	if !isExecutableFile(dest) {
		t.Fatalf("installed binary %s is not executable", dest)
	}

	// Overwriting an existing install must succeed too.
	if err := os.WriteFile(source, []byte("newer-bytes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := installProbeBinary(source, dest); err != nil {
		t.Fatalf("installProbeBinary() overwrite error = %v", err)
	}
	if data, _ := os.ReadFile(dest); string(data) != "newer-bytes" {
		t.Fatalf("overwritten binary content = %q, want %q", data, "newer-bytes")
	}
}

func TestSamePathIsCaseInsensitiveOnWindows(t *testing.T) {
	if !samePath(filepath.Join("a", "b"), filepath.Join("a", "b")) {
		t.Fatal("samePath() = false for identical paths")
	}
	if runtime.GOOS == "windows" && !samePath(`C:\Program Files\NetViz`, `c:\program files\netviz`) {
		t.Fatal("samePath() = false for case-differing Windows paths")
	}
}

func TestResolveProbeSourceHonorsExplicitPath(t *testing.T) {
	dir := t.TempDir()
	chosen := filepath.Join(dir, probeBinaryName())
	if err := os.WriteFile(chosen, []byte("probe"), 0o755); err != nil {
		t.Fatal(err)
	}

	path, found := resolveProbeSource(chosen)
	if !found || path != chosen {
		t.Fatalf("resolveProbeSource() = %q, %v, want %q, true", path, found, chosen)
	}

	missing := filepath.Join(dir, "missing", probeBinaryName())
	if _, found := resolveProbeSource(missing); found {
		t.Fatal("resolveProbeSource() found = true for missing explicit path")
	}
}

func TestRedactProbeOutputUsesExtraEnvironment(t *testing.T) {
	output := redactProbeOutput(
		"failed to connect to https://rmm.example.com with secret-key",
		[]string{
			probeEnvURL + "=https://rmm.example.com",
			probeEnvKey + "=secret-key",
		},
	)

	if strings.Contains(output, "https://rmm.example.com") || strings.Contains(output, "secret-key") {
		t.Fatalf("redactProbeOutput() leaked credential-bearing values: %q", output)
	}
}
