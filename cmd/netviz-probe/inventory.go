package main

import (
	"sort"

	"github.com/Spillers-Technology/netviz/internal/materialticket"
	"github.com/Spillers-Technology/netviz/internal/model"
)

// inventoryState prevents an initial scan from creating a device for every
// silent address in a CIDR. Once a real device has been observed, later silent
// observations for its IP are reported as down while the probe remains running.
type inventoryState struct {
	byID   map[string]materialticket.DeviceRecord
	idByIP map[string]string
}

func (s *inventoryState) records(hosts []model.HostObservation) []materialticket.DeviceRecord {
	if s.byID == nil {
		s.byID = make(map[string]materialticket.DeviceRecord)
		s.idByIP = make(map[string]string)
	}

	activeIDs := make(map[string]struct{})
	records := make(map[string]materialticket.DeviceRecord)

	// Record active/discovered devices first so an address change for the same
	// MAC cannot be overwritten by a stale down observation later in the batch.
	for _, host := range hosts {
		if !isDiscoveredHost(host) {
			continue
		}
		record := materialticket.ToDeviceRecord(host)
		activeIDs[record.ID] = struct{}{}
		records[record.ID] = record

		if previous, ok := s.byID[record.ID]; ok && previous.IP != record.IP {
			delete(s.idByIP, previous.IP)
		}
		s.byID[record.ID] = record
		s.idByIP[record.IP] = record.ID
	}

	// Silent IPs only become down records if this process previously observed a
	// real device there. This avoids manufacturing an inventory entry for every
	// unused address on the first scan.
	for _, host := range hosts {
		if isDiscoveredHost(host) {
			continue
		}
		id, ok := s.idByIP[host.IP]
		if !ok {
			continue
		}
		if _, activeElsewhere := activeIDs[id]; activeElsewhere {
			continue
		}

		record := s.byID[id]
		record.Status = "down"
		record.OpenPorts = []int{}
		record.LastSeen = host.LastUpdate
		s.byID[id] = record
		records[id] = record
	}

	ids := make([]string, 0, len(records))
	for id := range records {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	result := make([]materialticket.DeviceRecord, 0, len(ids))
	for _, id := range ids {
		result = append(result, records[id])
	}
	return result
}

func isDiscoveredHost(host model.HostObservation) bool {
	return host.Alive ||
		len(host.OpenPorts) > 0 ||
		host.MACAddress != "" ||
		host.Vendor != "" ||
		host.Hostname != ""
}
