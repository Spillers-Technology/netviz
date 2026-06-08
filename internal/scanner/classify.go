package scanner

import (
	"strings"

	"github.com/Spillers-Technology/netviz/internal/model"
)

func ClassifyHost(host model.HostObservation) string {
	if fromPorts := ClassifyDevice(portNumbers(host.OpenPorts)); fromPorts != "unknown" {
		return fromPorts
	}

	vendor := strings.ToLower(host.Vendor)
	hostname := strings.ToLower(host.Hostname)
	switch {
	case strings.Contains(vendor, "brother"),
		strings.Contains(vendor, "canon"),
		strings.Contains(vendor, "epson"),
		strings.Contains(vendor, "hewlett packard"),
		strings.Contains(hostname, "printer"):
		return "printer"
	case strings.Contains(vendor, "ubiquiti"),
		strings.Contains(vendor, "tp-link"),
		strings.Contains(vendor, "netgear"),
		strings.Contains(vendor, "cisco"),
		strings.Contains(vendor, "d-link"),
		strings.Contains(vendor, "zyxel"),
		strings.Contains(hostname, "gateway"),
		strings.Contains(hostname, "router"):
		return "network_device"
	case strings.Contains(vendor, "raspberry pi"):
		return "linux_or_iot"
	case strings.Contains(vendor, "apple"):
		return "apple_device"
	case strings.Contains(vendor, "microsoft"):
		return "windows_or_smb"
	case strings.Contains(vendor, "sonos"),
		strings.Contains(vendor, "nest"),
		strings.Contains(vendor, "amazon"),
		strings.Contains(vendor, "espressif"):
		return "iot_device"
	default:
		return "unknown"
	}
}

func ClassifyDevice(openPorts []int) string {
	ports := make(map[int]struct{}, len(openPorts))
	for _, port := range openPorts {
		ports[port] = struct{}{}
	}

	if hasAny(ports, 9100, 631) {
		return "printer"
	}
	if hasAny(ports, 445) {
		return "windows_or_smb"
	}
	if hasAny(ports, 3389) {
		return "windows_rdp"
	}
	if hasAny(ports, 22) {
		return "ssh_device"
	}
	if hasAny(ports, 80, 443, 8000, 8080, 8123, 8443, 8888) {
		return "web_device"
	}
	if hasAny(ports, 32400) {
		return "plex"
	}
	if hasAny(ports, 554) {
		return "camera_or_rtsp"
	}
	if hasAny(ports, 1883) {
		return "iot_device"
	}
	return "unknown"
}

func portNumbers(ports []model.PortObservation) []int {
	numbers := make([]int, 0, len(ports))
	for _, port := range ports {
		numbers = append(numbers, port.Port)
	}
	return numbers
}

func hasAny(ports map[int]struct{}, candidates ...int) bool {
	for _, port := range candidates {
		if _, ok := ports[port]; ok {
			return true
		}
	}
	return false
}
