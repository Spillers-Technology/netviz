package scanner

import (
	"net"
	"reflect"
	"testing"
)

func TestLocalNetworksFrom(t *testing.T) {
	parse := func(cidr string) net.Addr {
		ip, network, err := net.ParseCIDR(cidr)
		if err != nil {
			t.Fatal(err)
		}
		return &net.IPNet{IP: ip, Mask: network.Mask}
	}
	addrs := []net.Addr{
		parse("10.8.0.6/24"),                      // VPN adapter
		parse("192.168.1.23/24"),                  // home LAN
		parse("172.20.5.9/16"),                    // wide prefix narrowed to the local /24
		parse("192.168.1.99/24"),                  // same network twice
		parse("8.8.8.8/24"),                       // public, skipped
		parse("fe80::1/64"),                       // IPv6, skipped
		parse("192.168.50.10/32"),                 // single address, skipped
		&net.IPAddr{IP: net.IPv4(192, 168, 9, 9)}, // not an IPNet, skipped
	}
	got := localNetworksFrom(addrs)
	want := []string{"192.168.1.0/24", "10.8.0.0/24", "172.20.5.0/24"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("localNetworksFrom() = %v, want %v", got, want)
	}
}

func TestLocalNetworksFromEmpty(t *testing.T) {
	if got := localNetworksFrom(nil); len(got) != 0 {
		t.Fatalf("expected no networks, got %v", got)
	}
}
