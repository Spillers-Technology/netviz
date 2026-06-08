package scanner

import (
	"testing"

	"github.com/spilloid/netviz/internal/model"
)

func TestClassifyDevice(t *testing.T) {
	tests := []struct {
		name  string
		ports []int
		want  string
	}{
		{name: "printer jetdirect", ports: []int{9100}, want: "printer"},
		{name: "printer ipp", ports: []int{631}, want: "printer"},
		{name: "smb", ports: []int{445}, want: "windows_or_smb"},
		{name: "rdp", ports: []int{3389}, want: "windows_rdp"},
		{name: "ssh", ports: []int{22}, want: "ssh_device"},
		{name: "web", ports: []int{443}, want: "web_device"},
		{name: "plex", ports: []int{32400}, want: "plex"},
		{name: "rtsp", ports: []int{554}, want: "camera_or_rtsp"},
		{name: "mqtt", ports: []int{1883}, want: "iot_device"},
		{name: "unknown", ports: []int{25}, want: "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyDevice(tt.ports); got != tt.want {
				t.Fatalf("ClassifyDevice(%v) = %q, want %q", tt.ports, got, tt.want)
			}
		})
	}
}

func TestClassifyHostUsesVendorHints(t *testing.T) {
	tests := []struct {
		name   string
		vendor string
		want   string
	}{
		{name: "network vendor", vendor: "Ubiquiti", want: "network_device"},
		{name: "apple vendor", vendor: "Apple", want: "apple_device"},
		{name: "raspberry pi vendor", vendor: "Raspberry Pi", want: "linux_or_iot"},
		{name: "printer vendor", vendor: "Hewlett Packard", want: "printer"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			host := testHostObservation(tt.vendor)
			if got := ClassifyHost(host); got != tt.want {
				t.Fatalf("ClassifyHost vendor %q = %q, want %q", tt.vendor, got, tt.want)
			}
		})
	}
}

func testHostObservation(vendor string) model.HostObservation {
	return model.HostObservation{Vendor: vendor, DeviceType: "unknown"}
}
