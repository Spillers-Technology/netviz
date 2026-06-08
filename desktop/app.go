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

	"github.com/spilloid/netviz/internal/model"
	"github.com/spilloid/netviz/internal/scanner"
	"github.com/spilloid/netviz/internal/storage"
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

func (a *App) StartScan(cidr string) error {
	if err := scanner.ValidateCIDR(cidr); err != nil {
		return err
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
	a.results = make(map[string]model.HostObservation)
	a.run = model.ScanRun{CIDR: cidr}
	a.mu.Unlock()

	s := scanner.NewScanner(scanner.ScanConfig{
		CIDR:        cidr,
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
	var b strings.Builder
	writer := csv.NewWriter(&b)
	if err := writer.Write([]string{"IP", "Hostname", "Alive", "Open ports", "Guessed device type", "First seen", "Last updated"}); err != nil {
		return "", err
	}
	for _, host := range hosts {
		if err := writer.Write([]string{
			host.IP,
			host.Hostname,
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
		host.OpenPorts = append([]model.PortObservation(nil), host.OpenPorts...)
		hosts = append(hosts, host)
	}
	history := a.history
	a.mu.Unlock()

	if history != nil && run.ID != "" && len(hosts) > 0 {
		if err := history.SaveScanRun(context.Background(), run, hosts); err != nil {
			runtime.EventsEmit(a.ctx, "history:error", err.Error())
		} else {
			runtime.EventsEmit(a.ctx, "history:updated", nil)
		}
	}
	runtime.EventsEmit(a.ctx, "scan:state", map[string]any{"scanning": false})
}

func (a *App) snapshotHosts() []model.HostObservation {
	a.mu.Lock()
	defer a.mu.Unlock()
	hosts := make([]model.HostObservation, 0, len(a.results))
	for _, host := range a.results {
		host.OpenPorts = append([]model.PortObservation(nil), host.OpenPorts...)
		hosts = append(hosts, host)
	}
	sort.Slice(hosts, func(i, j int) bool {
		return hosts[i].IP < hosts[j].IP
	})
	return hosts
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
