package main

import (
	"bytes"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestParsePortList(t *testing.T) {
	ports, err := parsePortList("80,443, 80,22")
	if err != nil {
		t.Fatalf("parsePortList() error = %v", err)
	}
	want := []int{80, 443, 22}
	if !reflect.DeepEqual(ports, want) {
		t.Fatalf("parsePortList() = %v, want %v", ports, want)
	}
}

func TestParsePortListEmptyUsesScannerDefaults(t *testing.T) {
	ports, err := parsePortList("")
	if err != nil {
		t.Fatalf("parsePortList() error = %v", err)
	}
	if len(ports) != 0 {
		t.Fatalf("parsePortList() = %v, want empty slice for scanner defaults", ports)
	}
}

func TestParsePortListRejectsInvalidToken(t *testing.T) {
	if _, err := parsePortList("22,ssh"); err == nil {
		t.Fatal("parsePortList() error = nil, want invalid token error")
	}
}

func TestParsePortListRejectsTooManyPorts(t *testing.T) {
	values := make([]string, 0, maxSelectedPorts+1)
	for port := 1; port <= maxSelectedPorts+1; port++ {
		values = append(values, fmt.Sprint(port))
	}

	if _, err := parsePortList(strings.Join(values, ",")); err == nil {
		t.Fatalf("parsePortList() error = nil, want limit error for more than %d ports", maxSelectedPorts)
	}
}

func TestRunScanRejectsPortOutsideTCPRange(t *testing.T) {
	err := runScan([]string{"-cidr", "127.0.0.1/32", "-ports", "0"})
	if err == nil || !strings.Contains(err.Error(), "outside valid TCP range") {
		t.Fatalf("runScan() error = %v, want TCP range validation error", err)
	}
}

func TestUsageMentionsPortsFlag(t *testing.T) {
	var out bytes.Buffer
	printUsage(&out)
	if !strings.Contains(out.String(), "-ports 22,80,443") {
		t.Fatalf("usage did not mention -ports flag:\n%s", out.String())
	}
}
