package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/Spillers-Technology/netviz/internal/probeconfig"
	"github.com/Spillers-Technology/netviz/internal/scanner"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	probeEnvURL = "NETVIZ_ANCHORDESK_URL"
	probeEnvKey = "NETVIZ_ANCHORDESK_KEY"
)

type ProbeSetupRequest struct {
	CIDR              string `json:"cidr"`
	AnchorDeskURL     string `json:"anchordesk_url"`
	ProbeKey          string `json:"probe_key"`
	Interval          string `json:"interval"`
	ProbePath         string `json:"probe_path"`
	InstallPersistent bool   `json:"install_persistent"`
	StartAfterInstall bool   `json:"start_after_install"`
}

type ProbeConfigState struct {
	CIDR          string `json:"cidr"`
	AnchorDeskURL string `json:"anchordesk_url"`
	ProbeKey      string `json:"probe_key"`
	Interval      string `json:"interval"`
	ConfigPath    string `json:"config_path"`
}

type ProbeServiceStatus struct {
	ProbePath   string            `json:"probe_path"`
	InstallPath string            `json:"install_path"`
	ConfigPath  string            `json:"config_path"`
	Config     *ProbeConfigState `json:"config,omitempty"`
	Found      bool              `json:"found"`
	State      string            `json:"state"`
	Severity   string            `json:"severity"`
	Summary    string            `json:"summary"`
	Message    string            `json:"message"`
	Output     string            `json:"output"`
}

func (a *App) ChooseProbeBinary() (string, error) {
	path, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Choose netviz-probe",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "NetViz probe", Pattern: probeBinaryPattern()},
			{DisplayName: "All files", Pattern: "*"},
		},
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) GetProbeStatus(probePath string) (ProbeServiceStatus, error) {
	path, found := resolveProbeBinary(probePath)
	configPath, config := loadProbeConfigState()
	status := ProbeServiceStatus{
		ProbePath:   path,
		InstallPath: probeInstallPath(),
		ConfigPath:  configPath,
		Config:      config,
		Found:       found,
		State:       "missing",
		Severity:    "warning",
		Summary:     "Probe binary not found",
	}
	if !found {
		status.Message = fmt.Sprintf("netviz-probe was not found in %s or next to the desktop app", filepath.Dir(probeInstallPath()))
		return status, nil
	}

	output, err := runProbeCommand(context.Background(), path, nil, "status")
	status.Output = output
	status.State = parseProbeState(output, err)
	status.Severity = probeSeverity(status.State, err)
	status.Summary = probeSummary(status.State)
	if err != nil {
		status.Message = output
		if strings.TrimSpace(status.Message) == "" {
			status.Message = err.Error()
		}
		return status, nil
	}
	status.Message = output
	return status, nil
}

func (a *App) ProvisionProbe(req ProbeSetupRequest) (ProbeServiceStatus, error) {
	if err := validateProbeSetup(req); err != nil {
		return ProbeServiceStatus{}, err
	}
	interval, _ := parseProbeInterval(req.Interval)
	configPath, err := probeconfig.DefaultPath()
	if err != nil {
		return ProbeServiceStatus{}, err
	}
	cfg := probeconfig.Config{
		CIDR:          strings.TrimSpace(req.CIDR),
		AnchorDeskURL: strings.TrimSpace(req.AnchorDeskURL),
		ProbeKey:      strings.TrimSpace(req.ProbeKey),
		Interval:      interval.String(),
	}

	var outputs []string
	var path string
	if req.InstallPersistent {
		source, found := resolveProbeSource(req.ProbePath)
		if !found {
			return ProbeServiceStatus{}, fmt.Errorf("netviz-probe was not found in %s or next to the desktop app; choose the probe binary from the NetViz download", filepath.Dir(probeInstallPath()))
		}
		path = probeInstallPath()
		needCopy := !samePath(source, path)

		_, existingConfig := loadProbeConfigState()
		if err := probeconfig.Save(configPath, cfg); err != nil {
			return ProbeServiceStatus{}, fmt.Errorf("write probe config %s: %w", configPath, err)
		}
		outputs = append(outputs, fmt.Sprintf("wrote probe config: %s", configPath))

		status, err := a.GetProbeStatus(source)
		if err != nil {
			return ProbeServiceStatus{}, err
		}
		serviceState := status.State
		// A new binary means the service registration must be redone against
		// the standard install path, so a copy always forces a reinstall.
		needsInstall := needCopy || (status.State != "running" && status.State != "stopped")
		if existingConfig == nil {
			needsInstall = true
		}
		installed := false
		started := false
		if needsInstall {
			output, stopErr := runProbeCommand(context.Background(), source, nil, "stop")
			if stopErr == nil && output != "" {
				outputs = append(outputs, output)
			}
			output, uninstallErr := runProbeCommand(context.Background(), source, nil, "uninstall")
			if uninstallErr == nil && output != "" {
				outputs = append(outputs, output)
			}
			if needCopy {
				if err := installProbeBinary(source, path); err != nil {
					return ProbeServiceStatus{}, fmt.Errorf("install netviz-probe to %s: %w", path, err)
				}
				outputs = append(outputs, fmt.Sprintf("installed probe binary: %s", path))
			}
			output, err = runProbeCommand(context.Background(), path, nil, "install", "-config="+configPath)
			outputs = append(outputs, output)
			if err != nil {
				return ProbeServiceStatus{}, fmt.Errorf("install probe service: %w%s", err, formatCommandOutput(output))
			}
			installed = true
			serviceState = "stopped"
		}
		if req.StartAfterInstall && serviceState != "running" {
			output, err := runProbeCommand(context.Background(), path, nil, "start")
			outputs = append(outputs, output)
			if err != nil {
				return ProbeServiceStatus{}, fmt.Errorf("start probe service: %w%s", err, formatCommandOutput(output))
			}
			started = true
		}
		outputs = append([]string{probeProvisionSummary(installed, started, configPath)}, outputs...)
	} else {
		var found bool
		path, found = resolveProbeBinary(req.ProbePath)
		if !found {
			return ProbeServiceStatus{}, fmt.Errorf("netviz-probe was not found; choose the probe binary first")
		}
		env := probeCredentialEnv(req)
		args := []string{"run", "-cidr=" + strings.TrimSpace(req.CIDR), "-interval=" + interval.String(), "-once"}
		output, err := runProbeCommand(context.Background(), path, env, args...)
		outputs = append(outputs, output)
		if err != nil {
			return ProbeServiceStatus{}, fmt.Errorf("run one probe push: %w%s", err, formatCommandOutput(output))
		}
	}

	status, err := a.GetProbeStatus(path)
	status.Output = strings.TrimSpace(strings.Join(outputs, "\n"))
	if status.State == "running" || status.State == "stopped" {
		status.Severity = "success"
	}
	if len(outputs) > 0 {
		status.Summary = outputs[0]
	}
	return status, err
}

func (a *App) ProbeServiceAction(action string, probePath string) (ProbeServiceStatus, error) {
	switch action {
	case "start", "stop", "restart", "uninstall":
	default:
		return ProbeServiceStatus{}, fmt.Errorf("unsupported probe service action %q", action)
	}
	path, found := resolveProbeBinary(probePath)
	if !found {
		return ProbeServiceStatus{}, fmt.Errorf("netviz-probe was not found; choose the probe binary first")
	}
	output, err := runProbeCommand(context.Background(), path, nil, action)
	if err != nil {
		return ProbeServiceStatus{}, fmt.Errorf("%s probe service: %w%s", action, err, formatCommandOutput(output))
	}
	status, statusErr := a.GetProbeStatus(path)
	status.Output = output
	if statusErr == nil {
		status.Severity = "success"
		status.Summary = fmt.Sprintf("Probe service %s complete", action)
	}
	return status, statusErr
}

func validateProbeSetup(req ProbeSetupRequest) error {
	if err := scanner.ValidateCIDR(strings.TrimSpace(req.CIDR)); err != nil {
		return err
	}
	if _, err := parseProbeInterval(req.Interval); err != nil {
		return err
	}
	rawURL := strings.TrimSpace(req.AnchorDeskURL)
	if rawURL == "" {
		return errors.New("AnchorDesk URL is required")
	}
	parsedURL, err := url.ParseRequestURI(rawURL)
	if err != nil || parsedURL.Host == "" || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return fmt.Errorf("AnchorDesk URL must be an absolute http(s) URL: %q", rawURL)
	}
	if strings.TrimSpace(req.ProbeKey) == "" {
		return errors.New("probe API key is required")
	}
	return nil
}

func parseProbeInterval(raw string) (time.Duration, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Minute, nil
	}
	interval, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("interval must be a duration like 60s, 1m, or 5m: %w", err)
	}
	if interval <= 0 {
		return 0, errors.New("interval must be greater than zero")
	}
	return interval, nil
}

func probeCredentialEnv(req ProbeSetupRequest) []string {
	return []string{
		probeEnvURL + "=" + strings.TrimSpace(req.AnchorDeskURL),
		probeEnvKey + "=" + strings.TrimSpace(req.ProbeKey),
	}
}

func loadProbeConfigState() (string, *ProbeConfigState) {
	configPath, err := probeconfig.DefaultPath()
	if err != nil {
		return "", nil
	}
	cfg, err := probeconfig.Load(configPath)
	if err != nil {
		return configPath, nil
	}
	return configPath, &ProbeConfigState{
		CIDR:          cfg.CIDR,
		AnchorDeskURL: cfg.AnchorDeskURL,
		ProbeKey:      cfg.ProbeKey,
		Interval:      cfg.Interval,
		ConfigPath:    configPath,
	}
}

func runProbeCommand(ctx context.Context, path string, extraEnv []string, args ...string) (string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, path, args...)
	cmd.Env = append(os.Environ(), extraEnv...)
	hideConsoleWindow(cmd)
	output, err := cmd.CombinedOutput()
	return strings.TrimSpace(redactProbeOutput(string(output), extraEnv)), err
}

func resolveProbeBinary(preferred string) (string, bool) {
	if preferred = strings.TrimSpace(preferred); preferred != "" {
		if isExecutableFile(preferred) {
			return preferred, true
		}
		return preferred, false
	}
	for _, candidate := range probeBinaryCandidates() {
		if isExecutableFile(candidate) {
			return candidate, true
		}
	}
	return probeBinaryCandidates()[0], false
}

// probeInstallPath is the standard system location the desktop deploys the
// probe binary to before registering the service, so the service never runs
// out of a download folder or build tree that may move or disappear.
func probeInstallPath() string {
	if runtime.GOOS == "windows" {
		programFiles := os.Getenv("ProgramFiles")
		if programFiles == "" {
			programFiles = `C:\Program Files`
		}
		return filepath.Join(programFiles, "NetViz", probeBinaryName())
	}
	return filepath.Join("/usr/local/bin", probeBinaryName())
}

// resolveProbeSource picks the binary a persistent provision deploys: an
// explicitly chosen path wins, then a binary shipped alongside the desktop
// app whenever its version differs from the installed copy (so desktop
// upgrades carry the probe forward), then the installed copy itself.
func resolveProbeSource(preferred string) (string, bool) {
	if preferred = strings.TrimSpace(preferred); preferred != "" {
		return preferred, isExecutableFile(preferred)
	}
	installPath := probeInstallPath()
	installed := isExecutableFile(installPath)
	var bundled string
	for _, candidate := range probeBinaryCandidates() {
		if samePath(candidate, installPath) || !isExecutableFile(candidate) {
			continue
		}
		bundled = candidate
		break
	}
	switch {
	case bundled != "" && !installed:
		return bundled, true
	case bundled != "" && installed:
		bundledVersion := probeVersion(bundled)
		installedVersion := probeVersion(installPath)
		if bundledVersion == "" || installedVersion == "" || bundledVersion != installedVersion {
			return bundled, true
		}
		return installPath, true
	case installed:
		return installPath, true
	default:
		return installPath, false
	}
}

func probeVersion(path string) string {
	output, err := runProbeCommand(context.Background(), path, nil, "version")
	if err != nil {
		return ""
	}
	return output
}

// installProbeBinary copies the probe into place through a temp file and
// rename so a failed copy never leaves a truncated binary at the install
// path. The caller stops and uninstalls the service first; a running service
// would keep the destination locked on Windows.
func installProbeBinary(source, dest string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return elevationHint(err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(dest), "netviz-probe-*.tmp")
	if err != nil {
		return elevationHint(err)
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, in); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o755); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), dest); err != nil {
		return elevationHint(err)
	}
	return nil
}

func elevationHint(err error) error {
	if errors.Is(err, os.ErrPermission) {
		return fmt.Errorf("%w (run NetViz as administrator or root to install the probe binary)", err)
	}
	return err
}

func samePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func probeBinaryCandidates() []string {
	name := probeBinaryName()
	dirs := []string{filepath.Dir(probeInstallPath())}
	if executable, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(executable)
		dirs = append(dirs, exeDir, filepath.Dir(exeDir), filepath.Join(exeDir, "bin"))
	}
	if wd, err := os.Getwd(); err == nil {
		dirs = append(dirs,
			wd,
			filepath.Join(wd, "bin"),
			filepath.Join(wd, ".."),
			filepath.Join(wd, "..", "bin"),
			filepath.Join(wd, "..", "..", "bin"),
		)
	}

	seen := map[string]bool{}
	candidates := make([]string, 0, len(dirs))
	for _, dir := range dirs {
		candidate := filepath.Clean(filepath.Join(dir, name))
		if !seen[candidate] {
			seen[candidate] = true
			candidates = append(candidates, candidate)
		}
	}
	if len(candidates) == 0 {
		return []string{name}
	}
	return candidates
}

func probeBinaryName() string {
	if runtime.GOOS == "windows" {
		return "netviz-probe.exe"
	}
	return "netviz-probe"
}

func probeBinaryPattern() string {
	if runtime.GOOS == "windows" {
		return "netviz-probe.exe"
	}
	return "netviz-probe"
}

func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	if runtime.GOOS != "windows" && info.Mode()&0o111 == 0 {
		return false
	}
	return true
}

func parseProbeState(output string, err error) string {
	normalized := strings.ToLower(output)
	switch {
	case strings.Contains(normalized, "running"):
		return "running"
	case strings.Contains(normalized, "stopped"):
		return "stopped"
	case strings.Contains(normalized, "not installed"), strings.Contains(normalized, "does not exist"), strings.Contains(normalized, "no such service"):
		return "not installed"
	case err != nil:
		return "unknown"
	default:
		return "unknown"
	}
}

func probeSeverity(state string, err error) string {
	if err != nil {
		if state == "not installed" {
			return "warning"
		}
		return "error"
	}
	switch state {
	case "running":
		return "success"
	case "stopped", "not installed", "missing":
		return "warning"
	default:
		return "info"
	}
}

func probeSummary(state string) string {
	switch state {
	case "running":
		return "Probe service is running"
	case "stopped":
		return "Probe service is installed but stopped"
	case "not installed":
		return "Probe service is not installed"
	case "missing":
		return "Probe binary not found"
	default:
		return "Probe service status is unknown"
	}
}

func probeProvisionSummary(installed, started bool, configPath string) string {
	switch {
	case installed && started:
		return fmt.Sprintf("Probe installed and running with config %s", configPath)
	case installed:
		return fmt.Sprintf("Probe installed with config %s", configPath)
	case started:
		return fmt.Sprintf("Probe config updated and service started")
	default:
		return fmt.Sprintf("Probe config updated; running service will pick it up on the next scan cycle")
	}
}

func formatCommandOutput(output string) string {
	output = strings.TrimSpace(output)
	if output == "" {
		return ""
	}
	return ": " + output
}

func redactProbeOutput(output string, extraEnv []string) string {
	for _, env := range extraEnv {
		name, value, ok := strings.Cut(env, "=")
		if !ok || (name != probeEnvURL && name != probeEnvKey) || value == "" {
			continue
		}
		output = strings.ReplaceAll(output, value, "[redacted]")
	}
	for _, name := range []string{probeEnvURL, probeEnvKey} {
		if value := os.Getenv(name); value != "" {
			output = strings.ReplaceAll(output, value, "[redacted]")
		}
	}
	return output
}
