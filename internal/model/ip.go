package model

import (
	"bytes"
	"net"
)

// LessIP orders textual IP addresses numerically, so 10.0.0.2 sorts before
// 10.0.0.10 in exports and saved history. Unparseable values fall back to
// string order and sort after real addresses.
func LessIP(a, b string) bool {
	ipA := net.ParseIP(a)
	ipB := net.ParseIP(b)
	if ipA == nil || ipB == nil {
		if (ipA == nil) != (ipB == nil) {
			return ipB == nil
		}
		return a < b
	}
	return bytes.Compare(ipA.To16(), ipB.To16()) < 0
}
