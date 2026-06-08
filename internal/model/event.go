package model

import "time"

type ScanEventType string

const (
	EventScanStarted      ScanEventType = "scan_started"
	EventHostSeen         ScanEventType = "host_seen"
	EventHostAlive        ScanEventType = "host_alive"
	EventHostnameResolved ScanEventType = "hostname_resolved"
	EventHostEnriched     ScanEventType = "host_enriched"
	EventPortOpen         ScanEventType = "port_open"
	EventDeviceClassified ScanEventType = "device_classified"
	EventHostDone         ScanEventType = "host_done"
	EventScanFinished     ScanEventType = "scan_finished"
	EventScanError        ScanEventType = "scan_error"
)

type ScanEvent struct {
	Type         ScanEventType    `json:"type"`
	ScanID       string           `json:"scan_id"`
	Timestamp    time.Time        `json:"timestamp"`
	IP           string           `json:"ip,omitempty"`
	Hostname     string           `json:"hostname,omitempty"`
	Port         *PortObservation `json:"port,omitempty"`
	Host         *HostObservation `json:"host,omitempty"`
	DeviceType   string           `json:"device_type,omitempty"`
	Message      string           `json:"message,omitempty"`
	Error        string           `json:"error,omitempty"`
	CheckedHosts int              `json:"checked_hosts,omitempty"`
	TotalHosts   int              `json:"total_hosts,omitempty"`
}
