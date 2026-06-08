package scanner

import "testing"

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
