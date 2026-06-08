package scanner

import (
	"reflect"
	"testing"
)

func TestExpandCIDRSkipsNetworkAndBroadcastForNormalSubnet(t *testing.T) {
	got, err := ExpandCIDR("192.168.1.0/30")
	if err != nil {
		t.Fatalf("ExpandCIDR returned error: %v", err)
	}
	want := []string{"192.168.1.1", "192.168.1.2"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("hosts mismatch: got %v want %v", got, want)
	}
}

func TestExpandCIDRIncludesSingleHost(t *testing.T) {
	got, err := ExpandCIDR("10.0.0.42/32")
	if err != nil {
		t.Fatalf("ExpandCIDR returned error: %v", err)
	}
	want := []string{"10.0.0.42"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("hosts mismatch: got %v want %v", got, want)
	}
}

func TestValidateCIDRRejectsIPv6(t *testing.T) {
	if err := ValidateCIDR("fd00::/64"); err == nil {
		t.Fatal("expected IPv6 CIDR to be rejected")
	}
}
