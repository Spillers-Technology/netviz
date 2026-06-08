package model

import "time"

type ScanRun struct {
	ID            string    `json:"id"`
	CIDR          string    `json:"cidr"`
	StartedAt     time.Time `json:"started_at"`
	EndedAt       time.Time `json:"ended_at,omitempty"`
	HostCount     int       `json:"host_count"`
	AliveCount    int       `json:"alive_count"`
	OpenPortCount int       `json:"open_port_count"`
}

type ScanDiff struct {
	BaseRunID    string            `json:"base_run_id"`
	CompareRunID string            `json:"compare_run_id"`
	NewHosts     []HostObservation `json:"new_hosts"`
	MissingHosts []HostObservation `json:"missing_hosts"`
	ChangedHosts []HostChange      `json:"changed_hosts"`
}

type HostChange struct {
	IP                string          `json:"ip"`
	Before            HostObservation `json:"before"`
	After             HostObservation `json:"after"`
	HostnameChanged   bool            `json:"hostname_changed"`
	MACChanged        bool            `json:"mac_changed"`
	VendorChanged     bool            `json:"vendor_changed"`
	PortsChanged      bool            `json:"ports_changed"`
	DeviceTypeChanged bool            `json:"device_type_changed"`
}
