package main

import (
	"os"
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
