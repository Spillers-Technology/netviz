package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Spillers-Technology/netviz/internal/model"
	"github.com/Spillers-Technology/netviz/internal/scanner"
	"github.com/Spillers-Technology/netviz/internal/storage"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx context.Context

	mu       sync.Mutex
	cancel   context.CancelFunc
	scanning bool
	results  map[string]model.HostObservation
	history  *storage.SQLiteStore
	run      model.ScanRun
}

type SavedScanFile struct {
	Version string                  `json:"version"`
	SavedAt time.Time               `json:"saved_at"`
	Hosts   []model.HostObservation `json:"hosts"`
}

func NewApp() *App {
	return &App{results: make(map[string]model.HostObservation)}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	history, err := openHistoryStore()
	if err != nil {
		runtime.EventsEmit(a.ctx, "history:error", err.Error())
		return
	}
	a.mu.Lock()
	a.history = history
	a.mu.Unlock()
}

// maxSelectedPorts bounds the per-scan port list; the scanner stays a
// constrained LAN discovery tool, not a full port sweeper.
const maxSelectedPorts = 64

func (a *App) StartScan(cidr string, ports []int) error {
	return a.startScan(cidr, ports, false)
}

func (a *App) StartMonitorScan(cidr string, ports []int) error {
	return a.startScan(cidr, ports, true)
}

// DefaultPorts exposes the scanner's default port table to the frontend so
// the port picker lists exactly what a default scan probes.
func (a *App) DefaultPorts() []scanner.PortDef {
	return scanner.DefaultPortDefs
}

func (a *App) startScan(cidr string, ports []int, preserveResults bool) error {
	if err := scanner.ValidateCIDR(cidr); err != nil {
		return err
	}
	if len(ports) > maxSelectedPorts {
		return fmt.Errorf("too many ports selected (%d); the limit is %d", len(ports), maxSelectedPorts)
	}

	a.mu.Lock()
	if a.scanning {
		a.mu.Unlock()
		return fmt.Errorf("scan already running")
	}
	baseCtx := a.ctx
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	scanCtx, cancel := context.WithCancel(baseCtx)
	a.cancel = cancel
	a.scanning = true
	if !preserveResults {
		a.results = make(map[string]model.HostObservation)
	}
	a.run = model.ScanRun{CIDR: cidr}
	a.mu.Unlock()

	s := scanner.NewScanner(scanner.ScanConfig{
		CIDR:        cidr,
		Ports:       ports,
		Timeout:     450 * time.Millisecond,
		Concurrency: 64,
	})
	events, err := s.Scan(scanCtx)
	if err != nil {
		cancel()
		a.mu.Lock()
		a.scanning = false
		a.cancel = nil
		a.mu.Unlock()
		return err
	}

	runtime.EventsEmit(a.ctx, "scan:state", map[string]any{"scanning": true})
	go a.consumeEvents(events)
	return nil
}

func (a *App) CancelScan() {
	a.mu.Lock()
	cancel := a.cancel
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (a *App) ExportJSON() (string, error) {
	hosts := a.snapshotHosts()
	data, err := json.MarshalIndent(hosts, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) ExportCSV() (string, error) {
	hosts := a.snapshotHosts()
	return hostsToCSV(hosts)
}

func (a *App) SaveScanFile() error {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save NetViz Scan",
		DefaultFilename: "netviz-scan.json",
		Filters: []runtime.FileFilter{
			{DisplayName: "NetViz scan (*.json)", Pattern: "*.json"},
		},
		CanCreateDirectories: true,
	})
	if err != nil {
		return err
	}
	if path == "" {
		return nil
	}

	payload := SavedScanFile{
		Version: "0.0.1",
		SavedAt: time.Now().UTC(),
		Hosts:   a.snapshotHosts(),
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func (a *App) OpenScanFile() ([]model.HostObservation, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open NetViz Scan",
		Filters: []runtime.FileFilter{
			{DisplayName: "NetViz scan (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var saved SavedScanFile
	if err := json.Unmarshal(data, &saved); err != nil {
		var hosts []model.HostObservation
		if legacyErr := json.Unmarshal(data, &hosts); legacyErr != nil {
			return nil, err
		}
		saved.Hosts = hosts
	}

	a.mu.Lock()
	a.results = make(map[string]model.HostObservation, len(saved.Hosts))
	for _, host := range saved.Hosts {
		host.OpenPorts = clonePorts(host.OpenPorts)
		a.results[host.IP] = host
	}
	a.mu.Unlock()
	hosts := a.snapshotHosts()
	runtime.EventsEmit(a.ctx, "scan:loaded", hosts)
	return hosts, nil
}

func (a *App) EmitCurrentResults() {
	runtime.EventsEmit(a.ctx, "scan:loaded", a.snapshotHosts())
}

func (a *App) SaveCSVFile() error {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save NetViz CSV",
		DefaultFilename: "netviz-scan.csv",
		Filters: []runtime.FileFilter{
			{DisplayName: "CSV (*.csv)", Pattern: "*.csv"},
		},
		CanCreateDirectories: true,
	})
	if err != nil {
		return err
	}
	if path == "" {
		return nil
	}
	content, err := hostsToCSV(a.snapshotHosts())
	if err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o644)
}

func hostsToCSV(hosts []model.HostObservation) (string, error) {
	var b strings.Builder
	writer := csv.NewWriter(&b)
	if err := writer.Write([]string{"IP", "Hostname", "MAC address", "Vendor", "Alive", "Open ports", "Guessed device type", "First seen", "Last updated"}); err != nil {
		return "", err
	}
	for _, host := range hosts {
		if err := writer.Write([]string{
			host.IP,
			host.Hostname,
			host.MACAddress,
			host.Vendor,
			fmt.Sprintf("%t", host.Alive),
			formatPorts(host.OpenPorts),
			host.DeviceType,
			host.FirstSeen.Format(time.RFC3339),
			host.LastUpdate.Format(time.RFC3339),
		}); err != nil {
			return "", err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return "", err
	}
	return b.String(), nil
}

func (a *App) ListHistory() ([]model.ScanRun, error) {
	a.mu.Lock()
	history := a.history
	a.mu.Unlock()
	if history == nil {
		return []model.ScanRun{}, nil
	}
	return history.ListScanRuns(context.Background(), 20)
}

func (a *App) LatestDiff() (*model.ScanDiff, error) {
	a.mu.Lock()
	history := a.history
	a.mu.Unlock()
	if history == nil {
		return &model.ScanDiff{}, nil
	}
	return history.DiffLatest(context.Background())
}

// DiffRuns compares two stored runs picked in the history view.
func (a *App) DiffRuns(baseRunID string, compareRunID string) (*model.ScanDiff, error) {
	a.mu.Lock()
	history := a.history
	a.mu.Unlock()
	if history == nil {
		return &model.ScanDiff{}, nil
	}
	return history.DiffRuns(context.Background(), baseRunID, compareRunID)
}

// DeleteRun removes one stored scan run and its observations.
func (a *App) DeleteRun(runID string) error {
	a.mu.Lock()
	history := a.history
	a.mu.Unlock()
	if history == nil {
		return fmt.Errorf("history store is unavailable")
	}
	if err := history.DeleteScanRun(context.Background(), runID); err != nil {
		return err
	}
	runtime.EventsEmit(a.ctx, "history:updated", nil)
	return nil
}

func (a *App) consumeEvents(events <-chan model.ScanEvent) {
	for event := range events {
		switch event.Type {
		case model.EventScanStarted:
			a.mu.Lock()
			a.run.ID = event.ScanID
			a.run.StartedAt = event.Timestamp
			a.mu.Unlock()
		case model.EventScanFinished:
			a.mu.Lock()
			a.run.EndedAt = event.Timestamp
			a.mu.Unlock()
		}
		if event.Host != nil {
			a.mu.Lock()
			a.results[event.Host.IP] = *event.Host
			a.mu.Unlock()
		}
		runtime.EventsEmit(a.ctx, "scan:event", event)
	}

	a.mu.Lock()
	a.scanning = false
	a.cancel = nil
	run := a.run
	hosts := make([]model.HostObservation, 0, len(a.results))
	for _, host := range a.results {
		host.OpenPorts = clonePorts(host.OpenPorts)
		hosts = append(hosts, host)
	}
	history := a.history
	a.mu.Unlock()

	if history != nil && run.ID != "" && len(hosts) > 0 {
		if _, err := history.SaveScanRunCoalesced(context.Background(), run, hosts); err != nil {
			runtime.EventsEmit(a.ctx, "history:error", err.Error())
		} else {
			if _, err := history.PruneScanRuns(context.Background(), desktopRunsKept); err != nil {
				runtime.EventsEmit(a.ctx, "history:error", err.Error())
			}
			runtime.EventsEmit(a.ctx, "history:updated", nil)
		}
	}
	runtime.EventsEmit(a.ctx, "scan:state", map[string]any{"scanning": false})
}

// desktopRunsKept bounds local history. Coalescing already collapses idle
// monitor cycles, so 200 runs is roughly 200 observed changes of state.
const desktopRunsKept = 200

// HostHistory returns the stored observations of one IP, newest first, for
// the device detail panel.
func (a *App) HostHistory(ip string) ([]storage.HostHistoryEntry, error) {
	a.mu.Lock()
	history := a.history
	a.mu.Unlock()
	if history == nil || ip == "" {
		return []storage.HostHistoryEntry{}, nil
	}
	entries, err := history.HostHistory(context.Background(), ip, 25)
	if err != nil {
		return nil, err
	}
	if entries == nil {
		entries = []storage.HostHistoryEntry{}
	}
	return entries, nil
}

func (a *App) snapshotHosts() []model.HostObservation {
	a.mu.Lock()
	defer a.mu.Unlock()
	hosts := make([]model.HostObservation, 0, len(a.results))
	for _, host := range a.results {
		host.OpenPorts = clonePorts(host.OpenPorts)
		hosts = append(hosts, host)
	}
	sort.Slice(hosts, func(i, j int) bool {
		return model.LessIP(hosts[i].IP, hosts[j].IP)
	})
	return hosts
}

// clonePorts copies a host's port list and never returns nil: a nil slice
// serializes to JSON null, which the frontend and saved scan files treat as
// a list and index into.
func clonePorts(ports []model.PortObservation) []model.PortObservation {
	return append(make([]model.PortObservation, 0, len(ports)), ports...)
}

func formatPorts(ports []model.PortObservation) string {
	parts := make([]string, 0, len(ports))
	for _, port := range ports {
		parts = append(parts, fmt.Sprintf("%d/%s", port.Port, port.Service))
	}
	return strings.Join(parts, "; ")
}

func openHistoryStore() (*storage.SQLiteStore, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	return storage.OpenSQLite(filepath.Join(dir, "netviz", "history.db"))
}
