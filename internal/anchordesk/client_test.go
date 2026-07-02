package anchordesk

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestSendDevicesRequestAndResponse(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %q, want POST", r.Method)
		}
		if r.URL.Path != "/probe/devices" {
			t.Errorf("path = %q, want /probe/devices", r.URL.Path)
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", got)
		}
		if got := r.Header.Get("X-Probe-Key"); got != "probe-secret" {
			t.Errorf("X-Probe-Key = %q, want probe-secret", got)
		}

		var body struct {
			Devices []DeviceRecord `json:"devices"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if len(body.Devices) != 1 || body.Devices[0].ID != "device-1" {
			t.Errorf("devices = %#v, want device-1", body.Devices)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"received":1,"created":1,"updated":0,"errors":[]}`))
	}))
	defer server.Close()

	client := NewClient(server.URL+"/", "probe-secret", "0.1.0")
	result, err := client.SendDevices(context.Background(), []DeviceRecord{{ID: "device-1", OpenPorts: []int{}}})
	if err != nil {
		t.Fatalf("SendDevices: %v", err)
	}
	if result.Received != 1 || result.Created != 1 || result.Updated != 0 {
		t.Errorf("result = %#v", result)
	}
}

func TestHeartbeatWireShape(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/probe/heartbeat" {
			t.Errorf("path = %q, want /probe/heartbeat", r.URL.Path)
		}
		if got := r.Header.Get("X-Probe-Key"); got != "probe-secret" {
			t.Errorf("X-Probe-Key = %q, want probe-secret", got)
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body["status"] != "online" || body["version"] != "0.1.0" || body["cidr"] != "192.168.1.0/24" {
			t.Errorf("heartbeat body = %#v", body)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client := NewClient(server.URL, "probe-secret", "0.1.0")
	if err := client.Heartbeat(context.Background(), "online", "192.168.1.0/24"); err != nil {
		t.Fatalf("Heartbeat: %v", err)
	}
}

func TestNon2xxResponseIsTruncated(t *testing.T) {
	t.Parallel()

	body := strings.Repeat("x", maxErrorBodyLen) + "SHOULD-NOT-APPEAR"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, body, http.StatusBadGateway)
	}))
	defer server.Close()

	client := NewClient(server.URL, "probe-secret", "0.1.0")
	_, err := client.SendDevices(context.Background(), nil)
	if err == nil {
		t.Fatal("SendDevices error = nil, want non-2xx error")
	}
	if !strings.Contains(err.Error(), "502 Bad Gateway") {
		t.Errorf("error = %q, want status", err)
	}
	if strings.Contains(err.Error(), "SHOULD-NOT-APPEAR") {
		t.Errorf("error body was not truncated: %q", err)
	}
}

func TestClientDoesNotRetry(t *testing.T) {
	t.Parallel()

	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		http.Error(w, "try later", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	client := NewClient(server.URL, "probe-secret", "0.1.0")
	_, err := client.SendDevices(context.Background(), []DeviceRecord{{ID: "device-1"}})
	if err == nil {
		t.Fatal("SendDevices error = nil, want transport error")
	}
	if got := requests.Load(); got != 1 {
		t.Errorf("requests = %d, want 1; retry belongs to the probe loop", got)
	}
}
