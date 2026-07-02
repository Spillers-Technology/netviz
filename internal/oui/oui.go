// Package oui resolves MAC address prefixes to vendor names using an
// embedded snapshot of the IEEE MA-L (OUI) registry. The data file is
// tab-separated "prefix\tname" lines, gzipped, and parsed once on first
// lookup (~40k entries). Regenerate it from
// https://standards-oui.ieee.org/oui/oui.csv when refreshing the snapshot.
package oui

import (
	"bufio"
	"bytes"
	"compress/gzip"
	_ "embed"
	"strings"
	"sync"
)

//go:embed oui_data.gz
var data []byte

var (
	once  sync.Once
	table map[string]string
)

func load() {
	table = make(map[string]string, 40000)
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return
	}
	defer reader.Close()
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		prefix, name, ok := strings.Cut(line, "\t")
		if !ok || len(prefix) != 6 {
			continue
		}
		table[prefix] = name
	}
}

// Lookup returns the registered organization for a MAC address (any common
// separator style), or "" when the prefix is unassigned or the input is too
// short to carry an OUI.
func Lookup(mac string) string {
	hex := hexPrefix(mac)
	if hex == "" {
		return ""
	}
	once.Do(load)
	return table[hex]
}

func hexPrefix(mac string) string {
	var builder strings.Builder
	for _, r := range strings.ToLower(mac) {
		switch {
		case r >= '0' && r <= '9', r >= 'a' && r <= 'f':
			builder.WriteRune(r)
		case r == ':' || r == '-' || r == '.':
			continue
		default:
			return ""
		}
		if builder.Len() == 6 {
			return builder.String()
		}
	}
	return ""
}
