package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/Spillers-Technology/netviz/internal/model"
)

type ManagedCompany struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type ManagedProbe struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Site      string     `json:"site"`
	CompanyID *string    `json:"companyId"`
	CIDR      string     `json:"cidr"`
	Version   string     `json:"version"`
	Status    string     `json:"status"`
	LastSeen  *time.Time `json:"lastSeenAt"`
}

type ManagedDevice struct {
	ID              string          `json:"id"`
	ProbeID         string          `json:"probeId"`
	CompanyID       *string         `json:"companyId"`
	CompanyOverride bool            `json:"companyOverride"`
	Observation     json.RawMessage `json:"observation"`
}

type ManagedInventory struct {
	Companies []ManagedCompany `json:"companies"`
	Probes    []ManagedProbe   `json:"probes"`
	Devices   []ManagedDevice  `json:"devices"`
}

var ErrUnknownCompany = errors.New("company does not exist")

func (s *SQLiteStore) migrateManagedInventory(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		CREATE INDEX IF NOT EXISTS idx_scan_runs_probe ON scan_runs(managed_probe_id, started_at DESC);
		CREATE TABLE IF NOT EXISTS managed_companies (
			id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE
		);
		CREATE TABLE IF NOT EXISTS managed_probes (
			id TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
			site TEXT NOT NULL, company_id TEXT REFERENCES managed_companies(id),
			cidr TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'offline', last_seen TEXT,
			latest_run_id TEXT
		);
		CREATE TABLE IF NOT EXISTS managed_devices (
			id TEXT PRIMARY KEY, probe_id TEXT NOT NULL REFERENCES managed_probes(id),
			company_override INTEGER NOT NULL DEFAULT 0,
			company_id TEXT REFERENCES managed_companies(id),
			observation TEXT NOT NULL, observed_at TEXT NOT NULL
		);
	`)
	return err
}

func (s *SQLiteStore) SaveManagedCompany(ctx context.Context, company ManagedCompany, create bool) error {
	if create {
		_, err := s.db.ExecContext(ctx, "INSERT INTO managed_companies (id, name) VALUES (?, ?)", company.ID, company.Name)
		return err
	}
	return changed(s.db.ExecContext(ctx, "UPDATE managed_companies SET name = ? WHERE id = ?", company.Name, company.ID))
}

func changed(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		return sql.ErrNoRows
	}
	return err
}

func checkCompany(ctx context.Context, tx *sql.Tx, id *string) error {
	if id == nil {
		return nil
	}
	var found string
	err := tx.QueryRowContext(ctx, "SELECT id FROM managed_companies WHERE id = ?", *id).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUnknownCompany
	}
	return err
}

func hashProbeKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func (s *SQLiteStore) SaveManagedProbe(ctx context.Context, probe ManagedProbe, newKey string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := checkCompany(ctx, tx, probe.CompanyID); err != nil {
		return err
	}
	if newKey != "" {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO managed_probes (id, key_hash, name, site, company_id)
			VALUES (?, ?, ?, ?, ?)`, probe.ID, hashProbeKey(newKey), probe.Name, probe.Site, probe.CompanyID)
	} else {
		err = changed(tx.ExecContext(ctx, "UPDATE managed_probes SET name = ?, site = ?, company_id = ? WHERE id = ?",
			probe.Name, probe.Site, probe.CompanyID, probe.ID))
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SQLiteStore) RotateManagedProbeKey(ctx context.Context, id, key string) error {
	return changed(s.db.ExecContext(ctx, "UPDATE managed_probes SET key_hash = ? WHERE id = ?", hashProbeKey(key), id))
}

func (s *SQLiteStore) ManagedProbeByKey(ctx context.Context, key string) (ManagedProbe, error) {
	return scanManagedProbe(s.db.QueryRowContext(ctx, probeFields+" WHERE key_hash = ?", hashProbeKey(key)))
}

func (s *SQLiteStore) ManagedProbe(ctx context.Context, id string) (ManagedProbe, error) {
	return scanManagedProbe(s.db.QueryRowContext(ctx, probeFields+" WHERE id = ?", id))
}

const probeFields = "SELECT id, name, site, company_id, cidr, version, status, last_seen FROM managed_probes"

func scanManagedProbe(row interface{ Scan(...any) error }) (ManagedProbe, error) {
	var probe ManagedProbe
	var seen *string
	if err := row.Scan(&probe.ID, &probe.Name, &probe.Site, &probe.CompanyID, &probe.CIDR, &probe.Version, &probe.Status, &seen); err != nil {
		return probe, err
	}
	if seen != nil {
		t, err := parseTime(*seen)
		if err != nil {
			return probe, err
		}
		probe.LastSeen = &t
	}
	return probe, nil
}

func (s *SQLiteStore) ManagedHeartbeat(ctx context.Context, id, status, version, cidr string, now time.Time) error {
	return changed(s.db.ExecContext(ctx, `
		UPDATE managed_probes SET status = ?, version = ?, cidr = ?, last_seen = ? WHERE id = ?`,
		status, version, cidr, formatTime(now), id))
}

func (s *SQLiteStore) SetDeviceCompany(ctx context.Context, id string, override bool, companyID *string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := checkCompany(ctx, tx, companyID); err != nil {
		return err
	}
	if err := changed(tx.ExecContext(ctx, "UPDATE managed_devices SET company_override = ?, company_id = ? WHERE id = ?",
		override, companyID, id)); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SQLiteStore) SaveManagedRun(ctx context.Context, probeID string, run model.ScanRun, hosts []model.HostObservation, devices []ManagedDevice) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if err := saveScanRun(ctx, tx, run, hosts); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE scan_runs SET managed_probe_id = ? WHERE id = ?", probeID, run.ID); err != nil {
		return 0, err
	}
	if err := changed(tx.ExecContext(ctx, `
		UPDATE managed_probes SET latest_run_id = ?, last_seen = ?, status = 'online' WHERE id = ?`,
		run.ID, formatTime(run.EndedAt), probeID)); err != nil {
		return 0, err
	}
	created := 0
	for _, device := range devices {
		result, err := tx.ExecContext(ctx, `
			INSERT INTO managed_devices (id, probe_id, observation, observed_at)
			VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
			device.ID, probeID, string(device.Observation), formatTime(run.EndedAt))
		if err != nil {
			return 0, err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return 0, err
		}
		if n == 1 {
			created++
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE managed_devices SET probe_id = ?, observation = ?, observed_at = ?
			WHERE id = ? AND observed_at <= ?`,
			probeID, string(device.Observation), formatTime(run.EndedAt), device.ID, formatTime(run.EndedAt)); err != nil {
			return 0, err
		}
	}
	return created, tx.Commit()
}

func (s *SQLiteStore) LatestManagedRun(ctx context.Context, probeID string) (*model.ScanRun, error) {
	run, err := scanRunFromRows(s.db.QueryRowContext(ctx, `
		SELECT r.id, r.cidr, r.started_at, r.ended_at, r.host_count, r.alive_count, r.open_port_count
		FROM managed_probes p JOIN scan_runs r ON p.latest_run_id = r.id WHERE p.id = ?`, probeID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &run, nil
}

func readManagedRows[T any](ctx context.Context, tx *sql.Tx, query string, scan func(*sql.Rows) (T, error)) ([]T, error) {
	rows, err := tx.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []T{}
	for rows.Next() {
		item, err := scan(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *SQLiteStore) ManagedInventory(ctx context.Context) (ManagedInventory, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return ManagedInventory{}, err
	}
	defer tx.Rollback()
	var inventory ManagedInventory
	inventory.Companies, err = readManagedRows(ctx, tx, "SELECT id, name FROM managed_companies ORDER BY name", func(row *sql.Rows) (ManagedCompany, error) {
		var company ManagedCompany
		err := row.Scan(&company.ID, &company.Name)
		return company, err
	})
	if err != nil {
		return inventory, err
	}
	inventory.Probes, err = readManagedRows(ctx, tx, probeFields+" ORDER BY site, name, id", func(row *sql.Rows) (ManagedProbe, error) {
		return scanManagedProbe(row)
	})
	if err != nil {
		return inventory, err
	}
	inventory.Devices, err = readManagedRows(ctx, tx, `
		SELECT d.id, d.probe_id,
			CASE WHEN d.company_override THEN d.company_id ELSE p.company_id END,
			d.company_override, d.observation
		FROM managed_devices d JOIN managed_probes p ON p.id = d.probe_id
		ORDER BY d.id`, func(row *sql.Rows) (ManagedDevice, error) {
		var device ManagedDevice
		var observation string
		err := row.Scan(&device.ID, &device.ProbeID, &device.CompanyID, &device.CompanyOverride, &observation)
		device.Observation = json.RawMessage(observation)
		return device, err
	})
	if err != nil {
		return inventory, err
	}
	return inventory, tx.Commit()
}
