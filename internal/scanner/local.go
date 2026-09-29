package scanner

import (
	"net"
	"sort"
)

// LocalNetworks lists the private IPv4 networks this machine is attached to,
// as scannable CIDRs, so a first scan can start from the network the user is
// actually on instead of a guessed default. Wider prefixes are narrowed to the
// /24 around the local address: a /16 office LAN is 65k addresses, and the
// desktop scanner is meant for a quick look, not a sweep.
func LocalNetworks() []string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var addrs []net.Addr
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		ifaceAddrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		addrs = append(addrs, ifaceAddrs...)
	}
	return localNetworksFrom(addrs)
}

func localNetworksFrom(addrs []net.Addr) []string {
	seen := make(map[string]bool)
	var networks []string
	for _, addr := range addrs {
		ipnet, ok := addr.(*net.IPNet)
		if !ok {
			continue
		}
		ip := ipnet.IP.To4()
		if ip == nil || !ip.IsPrivate() {
			continue
		}
		ones, bits := ipnet.Mask.Size()
		if bits != 32 || ones == 32 {
			continue
		}
		if ones < 24 {
			ones = 24
		}
		network := &net.IPNet{IP: ip.Mask(net.CIDRMask(ones, 32)), Mask: net.CIDRMask(ones, 32)}
		cidr := network.String()
		if seen[cidr] {
			continue
		}
		seen[cidr] = true
		networks = append(networks, cidr)
	}
	// Home and small-office LANs (192.168/16) first: they are the likeliest
	// scan target, while 10/8 and 172.16/12 are often VPN or VM adapters.
	sort.SliceStable(networks, func(i, j int) bool {
		return rank(networks[i]) < rank(networks[j])
	})
	return networks
}

func rank(cidr string) int {
	ip, _, _ := net.ParseCIDR(cidr)
	switch {
	case ip.To4()[0] == 192:
		return 0
	case ip.To4()[0] == 10:
		return 1
	default:
		return 2
	}
}
