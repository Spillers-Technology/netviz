package oui

import (
	"strings"
	"testing"
)

func TestLookupKnownPrefixes(t *testing.T) {
	tests := []struct {
		mac  string
		want string
	}{
		// 00:00:0c is Cisco's original allocation and has been stable in the
		// registry for decades; same for Intel's 00:02:b3.
		{"00:00:0c:12:34:56", "cisco"},
		{"00-02-B3-99-88-77", "intel"},
	}
	for _, tt := range tests {
		got := Lookup(tt.mac)
		if got == "" || !strings.Contains(strings.ToLower(got), tt.want) {
			t.Fatalf("Lookup(%q) = %q, want vendor containing %q", tt.mac, got, tt.want)
		}
	}
}

func TestLookupUnknownOrInvalid(t *testing.T) {
	for _, mac := range []string{"", "zz:zz:zz:00:00:00", "00:11", "fa:ke"} {
		if got := Lookup(mac); got != "" && mac != "" {
			// Locally administered / random prefixes may legitimately miss;
			// only malformed input must return "".
			if mac == "zz:zz:zz:00:00:00" || mac == "00:11" || mac == "fa:ke" {
				t.Fatalf("Lookup(%q) = %q, want empty", mac, got)
			}
		}
	}
}

func TestTableLoads(t *testing.T) {
	Lookup("00:00:0c:00:00:00")
	if len(table) < 30000 {
		t.Fatalf("parsed %d OUI entries, want the full registry (>30000)", len(table))
	}
}
