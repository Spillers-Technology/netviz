package scanner

import (
	"bytes"
	"context"
	"net"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

type ARPEntry struct {
	IP         string
	MACAddress string
	Vendor     string
}

type ARPResolver struct {
	mu        sync.Mutex
	entries   map[string]ARPEntry
	refreshed time.Time
}

func NewARPResolver() *ARPResolver {
	return &ARPResolver{entries: map[string]ARPEntry{}}
}

func (r *ARPResolver) Lookup(ctx context.Context, ip string) (ARPEntry, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if time.Since(r.refreshed) > time.Second {
		r.entries = readARPTable(ctx)
		r.refreshed = time.Now()
	}
	entry, ok := r.entries[ip]
	return entry, ok
}

func readARPTable(ctx context.Context) map[string]ARPEntry {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "arp", "-a")
	} else {
		cmd = exec.CommandContext(ctx, "arp", "-an")
	}
	hideConsoleWindow(cmd)

	out, err := cmd.Output()
	if err != nil {
		return map[string]ARPEntry{}
	}
	return ParseARPTable(out)
}

var (
	ipPattern  = regexp.MustCompile(`(?:\(|\s|^)(\d{1,3}(?:\.\d{1,3}){3})(?:\)|\s|$)`)
	macPattern = regexp.MustCompile(`(?i)\b([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})\b`)
)

func ParseARPTable(out []byte) map[string]ARPEntry {
	entries := map[string]ARPEntry{}
	for _, line := range bytes.Split(out, []byte{'\n'}) {
		ipMatch := ipPattern.FindSubmatch(line)
		macMatch := macPattern.FindSubmatch(line)
		if len(ipMatch) < 2 || len(macMatch) < 2 {
			continue
		}

		ip := string(ipMatch[1])
		if net.ParseIP(ip) == nil {
			continue
		}
		mac := NormalizeMAC(string(macMatch[1]))
		if mac == "" || mac == "00:00:00:00:00:00" || mac == "ff:ff:ff:ff:ff:ff" {
			continue
		}
		entries[ip] = ARPEntry{
			IP:         ip,
			MACAddress: mac,
			Vendor:     VendorForMAC(mac),
		}
	}
	return entries
}

func NormalizeMAC(raw string) string {
	parts := strings.FieldsFunc(strings.ToLower(raw), func(r rune) bool {
		return r == ':' || r == '-'
	})
	if len(parts) != 6 {
		return ""
	}
	for i, part := range parts {
		if len(part) == 1 {
			parts[i] = "0" + part
		}
		if len(parts[i]) != 2 {
			return ""
		}
	}
	return strings.Join(parts, ":")
}
