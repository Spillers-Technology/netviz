package scanner

import (
	"encoding/binary"
	"fmt"
	"net"
)

func ValidateCIDR(cidr string) error {
	if cidr == "" {
		return fmt.Errorf("CIDR is required")
	}
	ip, network, err := net.ParseCIDR(cidr)
	if err != nil {
		return fmt.Errorf("invalid CIDR %q: %w", cidr, err)
	}
	if ip.To4() == nil || network.IP.To4() == nil {
		return fmt.Errorf("only IPv4 CIDR ranges are supported for now")
	}
	return nil
}

func ExpandCIDR(cidr string) ([]string, error) {
	if err := ValidateCIDR(cidr); err != nil {
		return nil, err
	}

	ip, network, _ := net.ParseCIDR(cidr)
	start := binary.BigEndian.Uint32(ip.To4())
	mask := binary.BigEndian.Uint32(network.Mask)
	networkStart := start & mask
	broadcast := networkStart | ^mask

	first := networkStart
	last := broadcast
	ones, bits := network.Mask.Size()
	if bits != 32 {
		return nil, fmt.Errorf("only IPv4 CIDR ranges are supported for now")
	}
	if ones <= 30 {
		first++
		last--
	}

	hosts := make([]string, 0, int(last-first)+1)
	for current := first; current <= last; current++ {
		var raw [4]byte
		binary.BigEndian.PutUint32(raw[:], current)
		hosts = append(hosts, net.IP(raw[:]).String())
		if current == ^uint32(0) {
			break
		}
	}
	return hosts, nil
}
