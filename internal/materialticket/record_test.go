package materialticket

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/Spillers-Technology/netviz/internal/model"
)

func TestToDeviceRecord(t *testing.T) {
	first := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	last := time.Date(2026, 6, 18, 12, 30, 0, 0, time.UTC)

	tests := []struct {
		name       string
		host       model.HostObservation
		wantID     string
		wantStatus string
		wantPorts  []int
	}{
		{
			name: "alive host with mac uses mac as id",
			host: model.HostObservation{
				IP:         "192.168.1.20",
				Hostname:   "ACME-PC-01",
				MACAddress: "aa:bb:cc:dd:ee:ff",
				Vendor:     "Dell",
				Alive:      true,
				DeviceType: "windows_or_smb",
				OpenPorts: []model.PortObservation{
					{Port: 22, Service: "ssh"},
					{Port: 445, Service: "smb"},
					{Port: 3389, Service: "rdp"},
				},
				FirstSeen:  first,
				LastUpdate: last,
			},
			wantID:     "aa:bb:cc:dd:ee:ff",
			wantStatus: "up",
			wantPorts:  []int{22, 445, 3389},
		},
		{
			name: "host without mac falls back to ip",
			host: model.HostObservation{
				IP:         "192.168.1.30",
				Alive:      true,
				OpenPorts:  []model.PortObservation{{Port: 80}},
				FirstSeen:  first,
				LastUpdate: last,
			},
			wantID:     "192.168.1.30",
			wantStatus: "up",
			wantPorts:  []int{80},
		},
		{
			name: "dead host is down",
			host: model.HostObservation{
				IP:         "192.168.1.40",
				MACAddress: "11:22:33:44:55:66",
				Alive:      false,
				OpenPorts:  []model.PortObservation{},
				FirstSeen:  first,
				LastUpdate: last,
			},
			wantID:     "11:22:33:44:55:66",
			wantStatus: "down",
			wantPorts:  []int{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ToDeviceRecord(tt.host)
			if got.ID != tt.wantID {
				t.Errorf("ID = %q, want %q", got.ID, tt.wantID)
			}
			if got.Status != tt.wantStatus {
				t.Errorf("Status = %q, want %q", got.Status, tt.wantStatus)
			}
			if len(got.OpenPorts) != len(tt.wantPorts) {
				t.Fatalf("OpenPorts = %v, want %v", got.OpenPorts, tt.wantPorts)
			}
			for i, p := range tt.wantPorts {
				if got.OpenPorts[i] != p {
					t.Errorf("OpenPorts[%d] = %d, want %d", i, got.OpenPorts[i], p)
				}
			}
			if !got.FirstSeen.Equal(tt.host.FirstSeen) {
				t.Errorf("FirstSeen = %v, want %v", got.FirstSeen, tt.host.FirstSeen)
			}
			if !got.LastSeen.Equal(tt.host.LastUpdate) {
				t.Errorf("LastSeen = %v, want %v", got.LastSeen, tt.host.LastUpdate)
			}
		})
	}
}

// TestDeviceRecordWireShape locks the JSON field names and types to the
// MaterialTicket v1 contract. Empty ports must marshal to [] (not null) so the
// MaterialTicket normalizer parses them.
func TestDeviceRecordWireShape(t *testing.T) {
	rec := ToDeviceRecord(model.HostObservation{
		IP:         "192.168.1.20",
		Hostname:   "ACME-PC-01",
		MACAddress: "aa:bb:cc:dd:ee:ff",
		Vendor:     "Dell",
		Alive:      true,
		DeviceType: "workstation",
		OpenPorts:  []model.PortObservation{{Port: 22}, {Port: 445}},
		FirstSeen:  time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC),
		LastUpdate: time.Date(2026, 6, 18, 12, 30, 0, 0, time.UTC),
	})

	data, err := json.Marshal(rec)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	for _, field := range []string{"id", "ip", "hostname", "mac", "vendor", "deviceType", "openPorts", "status", "firstSeen", "lastSeen"} {
		if _, ok := raw[field]; !ok {
			t.Errorf("contract field %q missing from wire output: %s", field, data)
		}
	}

	if got := string(raw["firstSeen"]); got != `"2026-06-18T12:00:00Z"` {
		t.Errorf("firstSeen = %s, want ISO-8601 RFC3339", got)
	}
	if got := string(raw["openPorts"]); got != "[22,445]" {
		t.Errorf("openPorts = %s, want [22,445]", got)
	}

	// Empty ports must serialize as an array, never null.
	empty, err := json.Marshal(ToDeviceRecord(model.HostObservation{IP: "10.0.0.1"}))
	if err != nil {
		t.Fatalf("marshal empty: %v", err)
	}
	var emptyRaw map[string]json.RawMessage
	if err := json.Unmarshal(empty, &emptyRaw); err != nil {
		t.Fatalf("unmarshal empty: %v", err)
	}
	if got := string(emptyRaw["openPorts"]); got != "[]" {
		t.Errorf("empty openPorts = %s, want []", got)
	}
}

func TestToDeviceRecords(t *testing.T) {
	hosts := []model.HostObservation{
		{IP: "192.168.1.1", Alive: true},
		{IP: "192.168.1.2", Alive: false},
	}
	records := ToDeviceRecords(hosts)
	if len(records) != 2 {
		t.Fatalf("len = %d, want 2", len(records))
	}
	if records[0].ID != "192.168.1.1" || records[1].ID != "192.168.1.2" {
		t.Errorf("unexpected ids: %q, %q", records[0].ID, records[1].ID)
	}
}
