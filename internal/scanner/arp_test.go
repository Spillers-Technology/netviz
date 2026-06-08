package scanner

import "testing"

func TestParseARPTableDarwin(t *testing.T) {
	raw := []byte("? (192.168.1.1) at 04:18:d6:aa:bb:cc on en0 ifscope [ethernet]\n")
	entries := ParseARPTable(raw)
	entry, ok := entries["192.168.1.1"]
	if !ok {
		t.Fatal("expected ARP entry")
	}
	if entry.MACAddress != "04:18:d6:aa:bb:cc" {
		t.Fatalf("MAC = %q", entry.MACAddress)
	}
	if entry.Vendor != "Ubiquiti" {
		t.Fatalf("Vendor = %q", entry.Vendor)
	}
}

func TestParseARPTableWindows(t *testing.T) {
	raw := []byte("  192.168.1.64          b8-27-eb-01-02-03     dynamic\n")
	entries := ParseARPTable(raw)
	entry, ok := entries["192.168.1.64"]
	if !ok {
		t.Fatal("expected ARP entry")
	}
	if entry.MACAddress != "b8:27:eb:01:02:03" {
		t.Fatalf("MAC = %q", entry.MACAddress)
	}
	if entry.Vendor != "Raspberry Pi" {
		t.Fatalf("Vendor = %q", entry.Vendor)
	}
}
