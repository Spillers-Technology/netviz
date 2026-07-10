package scanner

import (
	"fmt"
	"sort"
)

type PortDef struct {
	Port    int    `json:"port"`
	Service string `json:"service"`
}

var DefaultPortDefs = []PortDef{
	{21, "ftp"},
	{22, "ssh"},
	{23, "telnet"},
	{53, "dns"},
	{80, "http"},
	{135, "msrpc"},
	{139, "netbios"},
	{443, "https"},
	{445, "smb"},
	{515, "lpd"},
	{554, "rtsp"},
	{631, "ipp"},
	{1883, "mqtt"},
	{32400, "plex"},
	{9100, "jetdirect"},
	{3389, "rdp"},
	{5900, "vnc"},
	{8000, "http-alt"},
	{8080, "http-alt"},
	{8123, "home-assistant"},
	{8443, "https-alt"},
	{8888, "http-alt"},
}

func DefaultPorts() []int {
	ports := make([]int, 0, len(DefaultPortDefs))
	for _, def := range DefaultPortDefs {
		ports = append(ports, def.Port)
	}
	return ports
}

func ServiceName(port int) string {
	for _, def := range DefaultPortDefs {
		if def.Port == port {
			return def.Service
		}
	}
	return fmt.Sprintf("tcp/%d", port)
}

func NormalizePorts(ports []int) ([]int, error) {
	if len(ports) == 0 {
		ports = DefaultPorts()
	}

	seen := make(map[int]struct{}, len(ports))
	normalized := make([]int, 0, len(ports))
	for _, port := range ports {
		if port < 1 || port > 65535 {
			return nil, fmt.Errorf("port %d is outside valid TCP range", port)
		}
		if _, ok := seen[port]; ok {
			continue
		}
		seen[port] = struct{}{}
		normalized = append(normalized, port)
	}
	sort.Ints(normalized)
	return normalized, nil
}
