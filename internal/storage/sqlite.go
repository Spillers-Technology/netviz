package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Spillers-Technology/netviz/internal/model"
	_ "modernc.org/sqlite"
)

type SQLiteStore struct {
	db *sql.DB
}

func OpenSQLite(path string) (*SQLiteStore, error) {
	if path == "" {
		return nil, fmt.Errorf("SQLite path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	store := &SQLiteStore{db: db}
	if err := store.migrate(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

func (s *SQLiteStore) SaveScanRun(ctx context.Context, run model.ScanRun, hosts []model.HostObservation) error {
	if run.ID == "" {
		return fmt.Errorf("scan run ID is required")
	}
	run.HostCount, run.AliveCount, run.OpenPortCount = summarizeHosts(hosts)
	if run.EndedAt.IsZero() {
		run.EndedAt = time.Now().UTC()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `
		INSERT INTO scan_runs (id, cidr, started_at, ended_at, host_count, alive_count, open_port_count)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			cidr = excluded.cidr,
			started_at = excluded.started_at,
			ended_at = excluded.ended_at,
			host_count = excluded.host_count,
			alive_count = excluded.alive_count,
			open_port_count = excluded.open_port_count
	`, run.ID, run.CIDR, formatTime(run.StartedAt), formatTime(run.EndedAt), run.HostCount, run.AliveCount, run.OpenPortCount)
	if err != nil {
		return err
	}

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO host_observations (run_id, ip, hostname, mac_address, vendor, alive, device_type, first_seen, last_updated, open_ports_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(run_id, ip) DO UPDATE SET
			hostname = excluded.hostname,
			mac_address = excluded.mac_address,
			vendor = excluded.vendor,
			alive = excluded.alive,
			device_type = excluded.device_type,
			first_seen = excluded.first_seen,
			last_updated = excluded.last_updated,
			open_ports_json = excluded.open_ports_json
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, host := range hosts {
		portsJSON, err := marshalPorts(host.OpenPorts)
		if err != nil {
			return err
		}
		if _, err := stmt.ExecContext(ctx, run.ID, host.IP, host.Hostname, host.MACAddress, host.Vendor, host.Alive, host.DeviceType, formatTime(host.FirstSeen), formatTime(host.LastUpdate), string(portsJSON)); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *SQLiteStore) ListScanRuns(ctx context.Context, limit int) ([]model.ScanRun, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, cidr, started_at, ended_at, host_count, alive_count, open_port_count
		FROM scan_runs
		ORDER BY started_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var runs []model.ScanRun
	for rows.Next() {
		run, err := scanRunFromRows(rows)
		if err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (s *SQLiteStore) HostsForRun(ctx context.Context, runID string) ([]model.HostObservation, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT ip, hostname, mac_address, vendor, alive, device_type, first_seen, last_updated, open_ports_json
		FROM host_observations
		WHERE run_id = ?
		ORDER BY ip
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []model.HostObservation
	for rows.Next() {
		host, err := hostFromRows(rows)
		if err != nil {
			return nil, err
		}
		hosts = append(hosts, host)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// The SQL ORDER BY compares IPs as text (10.0.0.10 before 10.0.0.2);
	// re-sort numerically so every consumer lists addresses in scan order.
	sort.Slice(hosts, func(i, j int) bool {
		return model.LessIP(hosts[i].IP, hosts[j].IP)
	})
	return hosts, nil
}

// SaveScanRunCoalesced stores the run unless its host set is equivalent to
// the latest stored run (same hosts, aliveness, ports, names — timestamps
// ignored), in which case it extends that run's ended_at instead. This keeps
// monitor mode from writing thousands of identical runs a day while
// preserving every run where something actually changed. Returns true when
// the run was coalesced into the previous one.
func (s *SQLiteStore) SaveScanRunCoalesced(ctx context.Context, run model.ScanRun, hosts []model.HostObservation) (bool, error) {
	latest, err := s.ListScanRuns(ctx, 1)
	if err != nil {
		return false, err
	}
	if len(latest) == 1 && latest[0].CIDR == run.CIDR {
		previous, err := s.HostsForRun(ctx, latest[0].ID)
		if err != nil {
			return false, err
		}
		if hostsEquivalent(previous, hosts) {
			endedAt := run.EndedAt
			if endedAt.IsZero() {
				endedAt = time.Now().UTC()
			}
			return true, s.TouchScanRun(ctx, latest[0].ID, endedAt)
		}
	}
	return false, s.SaveScanRun(ctx, run, hosts)
}

// TouchScanRun extends a stored run's ended_at, marking its state as still
// current without writing a new run.
func (s *SQLiteStore) TouchScanRun(ctx context.Context, runID string, endedAt time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE scan_runs SET ended_at = ? WHERE id = ?`, formatTime(endedAt), runID)
	return err
}

// HostHistoryEntry is one observation of a host in a stored run.
type HostHistoryEntry struct {
	RunID     string                `json:"run_id"`
	StartedAt time.Time             `json:"started_at"`
	EndedAt   time.Time             `json:"ended_at"`
	Host      model.HostObservation `json:"host"`
}

// HostHistory returns the newest-first observations of a single IP across
// stored runs. With coalescing enabled each entry approximates a state
// change rather than a raw scan tick.
func (s *SQLiteStore) HostHistory(ctx context.Context, ip string, limit int) ([]HostHistoryEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.id, r.started_at, r.ended_at,
			h.ip, h.hostname, h.mac_address, h.vendor, h.alive, h.device_type, h.first_seen, h.last_updated, h.open_ports_json
		FROM host_observations h
		JOIN scan_runs r ON r.id = h.run_id
		WHERE h.ip = ?
		ORDER BY r.started_at DESC
		LIMIT ?
	`, ip, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []HostHistoryEntry
	for rows.Next() {
		var entry HostHistoryEntry
		var startedAt, endedAt, firstSeen, lastUpdated, portsJSON string
		var alive bool
		err := rows.Scan(&entry.RunID, &startedAt, &endedAt,
			&entry.Host.IP, &entry.Host.Hostname, &entry.Host.MACAddress, &entry.Host.Vendor, &alive, &entry.Host.DeviceType, &firstSeen, &lastUpdated, &portsJSON)
		if err != nil {
			return nil, err
		}
		entry.Host.Alive = alive
		if entry.StartedAt, err = parseTime(startedAt); err != nil {
			return nil, err
		}
		if entry.EndedAt, err = parseTime(endedAt); err != nil {
			return nil, err
		}
		if entry.Host.FirstSeen, err = parseTime(firstSeen); err != nil {
			return nil, err
		}
		if entry.Host.LastUpdate, err = parseTime(lastUpdated); err != nil {
			return nil, err
		}
		if entry.Host.OpenPorts, err = unmarshalPorts(portsJSON); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

// hostsEquivalent compares two host sets on identity fields, aliveness, and
// ports. Timestamps are deliberately ignored — they differ on every scan.
func hostsEquivalent(a []model.HostObservation, b []model.HostObservation) bool {
	if len(a) != len(b) {
		return false
	}
	byIP := hostsByIP(a)
	for _, host := range b {
		previous, ok := byIP[host.IP]
		if !ok ||
			previous.Hostname != host.Hostname ||
			previous.MACAddress != host.MACAddress ||
			previous.Vendor != host.Vendor ||
			previous.DeviceType != host.DeviceType ||
			previous.Alive != host.Alive ||
			!samePorts(previous.OpenPorts, host.OpenPorts) {
			return false
		}
	}
	return true
}

// PruneScanRuns deletes all but the newest keep runs and their host
// observations, returning how many runs were removed. Observations are
// deleted explicitly rather than via the FK cascade so pruning does not
// depend on per-connection PRAGMA state.
func (s *SQLiteStore) PruneScanRuns(ctx context.Context, keep int) (int, error) {
	if keep < 1 {
		keep = 1
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	const keepQuery = `SELECT id FROM scan_runs ORDER BY started_at DESC LIMIT ?`
	if _, err := tx.ExecContext(ctx, `DELETE FROM host_observations WHERE run_id NOT IN (`+keepQuery+`)`, keep); err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM scan_runs WHERE id NOT IN (`+keepQuery+`)`, keep)
	if err != nil {
		return 0, err
	}
	removed, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return int(removed), tx.Commit()
}

// DeleteScanRun removes one stored run and its host observations.
func (s *SQLiteStore) DeleteScanRun(ctx context.Context, runID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM host_observations WHERE run_id = ?`, runID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM scan_runs WHERE id = ?`, runID)
	if err != nil {
		return err
	}
	removed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if removed == 0 {
		return fmt.Errorf("scan run %q not found", runID)
	}
	return tx.Commit()
}

func (s *SQLiteStore) DiffLatest(ctx context.Context) (*model.ScanDiff, error) {
	runs, err := s.ListScanRuns(ctx, 2)
	if err != nil {
		return nil, err
	}
	if len(runs) < 2 {
		return &model.ScanDiff{}, nil
	}
	return s.DiffRuns(ctx, runs[1].ID, runs[0].ID)
}

func (s *SQLiteStore) DiffRuns(ctx context.Context, baseRunID string, compareRunID string) (*model.ScanDiff, error) {
	baseHosts, err := s.HostsForRun(ctx, baseRunID)
	if err != nil {
		return nil, err
	}
	compareHosts, err := s.HostsForRun(ctx, compareRunID)
	if err != nil {
		return nil, err
	}
	diff := DiffHosts(baseRunID, compareRunID, baseHosts, compareHosts)
	return &diff, nil
}

func DiffHosts(baseRunID string, compareRunID string, baseHosts []model.HostObservation, compareHosts []model.HostObservation) model.ScanDiff {
	base := hostsByIP(baseHosts)
	compare := hostsByIP(compareHosts)

	diff := model.ScanDiff{BaseRunID: baseRunID, CompareRunID: compareRunID}
	for ip, after := range compare {
		before, ok := base[ip]
		if !ok {
			diff.NewHosts = append(diff.NewHosts, after)
			continue
		}
		change := model.HostChange{
			IP:                ip,
			Before:            before,
			After:             after,
			HostnameChanged:   before.Hostname != after.Hostname,
			MACChanged:        before.MACAddress != after.MACAddress,
			VendorChanged:     before.Vendor != after.Vendor,
			PortsChanged:      !samePorts(before.OpenPorts, after.OpenPorts),
			DeviceTypeChanged: before.DeviceType != after.DeviceType,
		}
		if change.HostnameChanged || change.MACChanged || change.VendorChanged || change.PortsChanged || change.DeviceTypeChanged {
			diff.ChangedHosts = append(diff.ChangedHosts, change)
		}
	}
	for ip, before := range base {
		if _, ok := compare[ip]; !ok {
			diff.MissingHosts = append(diff.MissingHosts, before)
		}
	}

	sortHosts(diff.NewHosts)
	sortHosts(diff.MissingHosts)
	sort.Slice(diff.ChangedHosts, func(i, j int) bool {
		return diff.ChangedHosts[i].IP < diff.ChangedHosts[j].IP
	})
	return diff
}

func (s *SQLiteStore) migrate(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		PRAGMA journal_mode = WAL;
		PRAGMA foreign_keys = ON;

		CREATE TABLE IF NOT EXISTS scan_runs (
			id TEXT PRIMARY KEY,
			cidr TEXT NOT NULL,
			started_at TEXT NOT NULL,
			ended_at TEXT NOT NULL,
			host_count INTEGER NOT NULL,
			alive_count INTEGER NOT NULL,
			open_port_count INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS host_observations (
			run_id TEXT NOT NULL,
			ip TEXT NOT NULL,
			hostname TEXT NOT NULL,
			mac_address TEXT NOT NULL DEFAULT '',
			vendor TEXT NOT NULL DEFAULT '',
			alive INTEGER NOT NULL,
			device_type TEXT NOT NULL,
			first_seen TEXT NOT NULL,
			last_updated TEXT NOT NULL,
			open_ports_json TEXT NOT NULL,
			PRIMARY KEY (run_id, ip),
			FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_scan_runs_started_at ON scan_runs(started_at DESC);
	`)
	if err != nil {
		return err
	}

	for _, stmt := range []string{
		`ALTER TABLE host_observations ADD COLUMN mac_address TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE host_observations ADD COLUMN vendor TEXT NOT NULL DEFAULT ''`,
	} {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			return err
		}
	}
	return nil
}

type scanRunScanner interface {
	Scan(dest ...any) error
}

func scanRunFromRows(row scanRunScanner) (model.ScanRun, error) {
	var run model.ScanRun
	var startedAt, endedAt string
	err := row.Scan(&run.ID, &run.CIDR, &startedAt, &endedAt, &run.HostCount, &run.AliveCount, &run.OpenPortCount)
	if err != nil {
		return run, err
	}
	run.StartedAt, err = parseTime(startedAt)
	if err != nil {
		return run, err
	}
	run.EndedAt, err = parseTime(endedAt)
	return run, err
}

func hostFromRows(row scanRunScanner) (model.HostObservation, error) {
	var host model.HostObservation
	var firstSeen, lastUpdated, portsJSON string
	var alive bool
	err := row.Scan(&host.IP, &host.Hostname, &host.MACAddress, &host.Vendor, &alive, &host.DeviceType, &firstSeen, &lastUpdated, &portsJSON)
	if err != nil {
		return host, err
	}
	host.Alive = alive
	host.FirstSeen, err = parseTime(firstSeen)
	if err != nil {
		return host, err
	}
	host.LastUpdate, err = parseTime(lastUpdated)
	if err != nil {
		return host, err
	}
	host.OpenPorts, err = unmarshalPorts(portsJSON)
	return host, err
}

// marshalPorts and unmarshalPorts keep open_ports_json and the decoded slice
// non-nil so hosts with no open ports round-trip as [] rather than null;
// consumers (the desktop frontend in particular) index the slice directly.
func marshalPorts(ports []model.PortObservation) ([]byte, error) {
	if ports == nil {
		ports = []model.PortObservation{}
	}
	return json.Marshal(ports)
}

func unmarshalPorts(portsJSON string) ([]model.PortObservation, error) {
	ports := []model.PortObservation{}
	if err := json.Unmarshal([]byte(portsJSON), &ports); err != nil {
		return nil, err
	}
	if ports == nil {
		ports = []model.PortObservation{}
	}
	return ports, nil
}

func summarizeHosts(hosts []model.HostObservation) (hostCount int, aliveCount int, openPortCount int) {
	hostCount = len(hosts)
	for _, host := range hosts {
		if host.Alive {
			aliveCount++
		}
		openPortCount += len(host.OpenPorts)
	}
	return hostCount, aliveCount, openPortCount
}

func hostsByIP(hosts []model.HostObservation) map[string]model.HostObservation {
	byIP := make(map[string]model.HostObservation, len(hosts))
	for _, host := range hosts {
		byIP[host.IP] = host
	}
	return byIP
}

func samePorts(a []model.PortObservation, b []model.PortObservation) bool {
	if len(a) != len(b) {
		return false
	}
	ap := make([]int, len(a))
	bp := make([]int, len(b))
	for i := range a {
		ap[i] = a[i].Port
	}
	for i := range b {
		bp[i] = b[i].Port
	}
	sort.Ints(ap)
	sort.Ints(bp)
	for i := range ap {
		if ap[i] != bp[i] {
			return false
		}
	}
	return true
}

func sortHosts(hosts []model.HostObservation) {
	sort.Slice(hosts, func(i, j int) bool {
		return model.LessIP(hosts[i].IP, hosts[j].IP)
	})
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func parseTime(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, nil
	}
	return time.Parse(time.RFC3339Nano, value)
}
