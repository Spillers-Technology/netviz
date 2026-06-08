package scanner

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/Spillers-Technology/netviz/internal/model"
)

func TestScannerEmitsPortOpenAndHostDone(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	doneAccept := make(chan struct{})
	go func() {
		defer close(doneAccept)
		conn, err := listener.Accept()
		if err == nil {
			_ = conn.Close()
		}
	}()

	port := listener.Addr().(*net.TCPAddr).Port
	scanner := NewScanner(ScanConfig{
		CIDR:        "127.0.0.1/32",
		Ports:       []int{port},
		Timeout:     100 * time.Millisecond,
		Concurrency: 1,
	})

	events, err := scanner.Scan(context.Background())
	if err != nil {
		t.Fatalf("Scan returned error: %v", err)
	}

	var sawOpen bool
	var sawDone bool
	for event := range events {
		switch event.Type {
		case model.EventPortOpen:
			sawOpen = true
		case model.EventHostDone:
			sawDone = true
			if event.Host == nil || !event.Host.Alive {
				t.Fatalf("host_done should include alive host observation: %#v", event.Host)
			}
		}
	}

	if !sawOpen {
		t.Fatal("expected port_open event")
	}
	if !sawDone {
		t.Fatal("expected host_done event")
	}
	<-doneAccept
}

func TestScannerRejectsBadCIDR(t *testing.T) {
	scanner := NewScanner(ScanConfig{CIDR: "not-a-cidr"})
	if _, err := scanner.Scan(context.Background()); err == nil {
		t.Fatal("expected bad CIDR to fail")
	}
}
