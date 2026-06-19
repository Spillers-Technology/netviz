package main

import (
	"testing"
	"time"

	"github.com/Spillers-Technology/netviz/internal/model"
)

func TestInventorySkipsNeverDiscoveredAddresses(t *testing.T) {
	t.Parallel()

	state := &inventoryState{}
	records := state.records([]model.HostObservation{
		{IP: "192.168.1.10", Alive: true, Hostname: "workstation"},
		{IP: "192.168.1.11"},
		{IP: "192.168.1.12"},
	})
	if len(records) != 1 || records[0].IP != "192.168.1.10" {
		t.Errorf("records = %#v, want only discovered host", records)
	}
}

func TestInventoryReportsKnownDeviceDown(t *testing.T) {
	t.Parallel()

	state := &inventoryState{}
	state.records([]model.HostObservation{{
		IP:         "192.168.1.10",
		MACAddress: "aa:bb:cc:dd:ee:ff",
		Hostname:   "workstation",
		Alive:      true,
	}})

	checkedAt := time.Date(2026, 6, 19, 3, 0, 0, 0, time.UTC)
	records := state.records([]model.HostObservation{{
		IP:         "192.168.1.10",
		LastUpdate: checkedAt,
	}})
	if len(records) != 1 {
		t.Fatalf("records = %#v, want known device down record", records)
	}
	if records[0].ID != "aa:bb:cc:dd:ee:ff" || records[0].Status != "down" {
		t.Errorf("down record = %#v", records[0])
	}
	if records[0].Hostname != "workstation" {
		t.Errorf("known identity was not preserved: %#v", records[0])
	}
	if !records[0].LastSeen.Equal(checkedAt) {
		t.Errorf("LastSeen = %v, want %v", records[0].LastSeen, checkedAt)
	}
}

func TestInventoryMACMoveDoesNotEmitStaleDownRecord(t *testing.T) {
	t.Parallel()

	state := &inventoryState{}
	state.records([]model.HostObservation{{
		IP:         "192.168.1.10",
		MACAddress: "aa:bb:cc:dd:ee:ff",
		Alive:      true,
	}})

	records := state.records([]model.HostObservation{
		{IP: "192.168.1.10"},
		{
			IP:         "192.168.1.20",
			MACAddress: "aa:bb:cc:dd:ee:ff",
			Alive:      true,
		},
	})
	if len(records) != 1 {
		t.Fatalf("records = %#v, want one moved device", records)
	}
	if records[0].IP != "192.168.1.20" || records[0].Status != "up" {
		t.Errorf("moved record = %#v", records[0])
	}
}
