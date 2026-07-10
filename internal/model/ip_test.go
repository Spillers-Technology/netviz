package model

import (
	"sort"
	"testing"
)

func TestLessIPOrdersNumerically(t *testing.T) {
	ips := []string{"10.0.0.10", "10.0.0.2", "192.168.1.1", "10.0.0.1", "not-an-ip", "9.9.9.9"}
	sort.Slice(ips, func(i, j int) bool { return LessIP(ips[i], ips[j]) })

	want := []string{"9.9.9.9", "10.0.0.1", "10.0.0.2", "10.0.0.10", "192.168.1.1", "not-an-ip"}
	for i, ip := range want {
		if ips[i] != ip {
			t.Fatalf("position %d: got %q, want %q (full order %v)", i, ips[i], ip, ips)
		}
	}
}

func TestLessIPIsStrictWeakOrdering(t *testing.T) {
	if LessIP("10.0.0.1", "10.0.0.1") {
		t.Fatal("an address must not sort before itself")
	}
	if LessIP("10.0.0.2", "10.0.0.10") == LessIP("10.0.0.10", "10.0.0.2") {
		t.Fatal("comparison must be asymmetric for distinct addresses")
	}
}
