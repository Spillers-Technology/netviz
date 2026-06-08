package scanner

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
	if hasAny(ports, 80, 443, 8080, 8443) {
		return "web_device"
	}
	if hasAny(ports, 32400) {
		return "plex"
	}
	return "unknown"
}

func hasAny(ports map[int]struct{}, candidates ...int) bool {
	for _, port := range candidates {
		if _, ok := ports[port]; ok {
			return true
		}
	}
	return false
}
