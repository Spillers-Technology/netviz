// Package materialticket maps netviz scan results to the MaterialTicket probe
// contract and pushes them to a MaterialTicket backend.
//
// MaterialTicket owns the authoritative normalizer
// (backend/src/providers/NetVizProvider.ts). Keep DeviceRecord's JSON tags in
// lockstep with that file; if field names change, either keep an alias there or
// bump ContractVersion and update both sides in one change.
package materialticket

import (
	"time"

	"github.com/Spillers-Technology/netviz/internal/model"
)

// ContractVersion is the wire contract netviz emits. It must match
// NETVIZ_CONTRACT_VERSION on the MaterialTicket side.
const ContractVersion = 1

// DeviceRecord is one device in the MaterialTicket probe ingest contract (v1).
// MaterialTicket tolerates several aliases on input; netviz emits the canonical
// field names below.
type DeviceRecord struct {
	ID         string    `json:"id"`
	IP         string    `json:"ip,omitempty"`
	Hostname   string    `json:"hostname,omitempty"`
	MAC        string    `json:"mac,omitempty"`
	Vendor     string    `json:"vendor,omitempty"`
	OS         string    `json:"os,omitempty"`
	DeviceType string    `json:"deviceType,omitempty"`
	OpenPorts  []int     `json:"openPorts"`
	Status     string    `json:"status"`
	FirstSeen  time.Time `json:"firstSeen"`
	LastSeen   time.Time `json:"lastSeen"`
}

// ToDeviceRecord maps a netviz host observation onto the MaterialTicket wire
// shape. id prefers the MAC (the stablest per-device key) and falls back to the
// IP, matching MaterialTicket's own id->mac->ip fallback.
func ToDeviceRecord(h model.HostObservation) DeviceRecord {
	id := h.MACAddress
	if id == "" {
		id = h.IP
	}

	ports := make([]int, 0, len(h.OpenPorts))
	for _, p := range h.OpenPorts {
		ports = append(ports, p.Port)
	}

	status := "down"
	if h.Alive {
		status = "up"
	}

	return DeviceRecord{
		ID:         id,
		IP:         h.IP,
		Hostname:   h.Hostname,
		MAC:        h.MACAddress,
		Vendor:     h.Vendor,
		DeviceType: h.DeviceType,
		OpenPorts:  ports,
		Status:     status,
		FirstSeen:  h.FirstSeen,
		LastSeen:   h.LastUpdate,
	}
}

// ToDeviceRecords maps a slice of host observations to device records.
func ToDeviceRecords(hosts []model.HostObservation) []DeviceRecord {
	records := make([]DeviceRecord, 0, len(hosts))
	for _, h := range hosts {
		records = append(records, ToDeviceRecord(h))
	}
	return records
}
