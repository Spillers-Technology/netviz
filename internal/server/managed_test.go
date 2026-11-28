package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Spillers-Technology/netviz/internal/storage"
)

func TestManagedProbeInventoryAcrossSites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "netviz.db")
	store, err := storage.OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	srv := httptest.NewServer(New(Config{Store: store, IngestKey: "legacy-fixture", InventoryKey: "inventory-fixture"}).Handler())
	defer srv.Close()
	request := func(method, path, body, header, key string, want int) []byte {
		t.Helper()
		req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		if header != "" {
			req.Header.Set(header, key)
		}
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		data, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != want {
			t.Fatalf("%s %s returned %d, want %d: %s", method, path, res.StatusCode, want, data)
		}
		return data
	}

	var company storage.ManagedCompany
	if err := json.Unmarshal(request("POST", "/api/management/companies", `{"name":"Acme"}`, "", "", 201), &company); err != nil {
		t.Fatal(err)
	}
	register := func(name string) map[string]string {
		t.Helper()
		body, _ := json.Marshal(map[string]string{"name": "Edge", "site": name, "companyId": company.ID})
		var result map[string]string
		if err := json.Unmarshal(request("POST", "/api/management/probes", string(body), "", "", 201), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	hq, warehouse := register("HQ"), register("Warehouse")
	for _, probe := range []map[string]string{hq, warehouse} {
		request("POST", "/probe/heartbeat", `{"cidr":"192.168.1.0/24","status":"online"}`, "X-Probe-Key", probe["key"], 200)
	}
	request("POST", "/probe/devices", `{"devices":[{"id":"192.168.1.5","ip":"192.168.1.5","hostname":"hq-device"}]}`, "X-Probe-Key", hq["key"], 200)
	request("POST", "/probe/devices", `{"devices":[{"id":"192.168.1.5","ip":"192.168.1.5","hostname":"warehouse-device"}]}`, "X-Probe-Key", warehouse["key"], 200)
	request("POST", "/probe/devices", `{"devices":[{"id":"192.168.1.5","ip":"192.168.1.5","hostname":"legacy-device"}]}`, "X-Probe-Key", "legacy-fixture", 200)

	hqState := request("GET", "/api/state?probe="+hq["id"], "", "", "", 200)
	if !bytes.Contains(hqState, []byte("hq-device")) || bytes.Contains(hqState, []byte("warehouse-device")) {
		t.Fatalf("wrong topology for HQ: %s", hqState)
	}
	legacy := request("GET", "/api/state", "", "", "", 200)
	if !bytes.Contains(legacy, []byte("legacy-device")) {
		t.Fatalf("legacy feed changed: %s", legacy)
	}

	request("GET", "/api/v1/inventory", "", "Authorization", "Bearer "+hq["key"], 401)
	snapshot := func() storage.ManagedInventory {
		t.Helper()
		var data storage.ManagedInventory
		body := request("GET", "/api/v1/inventory", "", "Authorization", "Bearer inventory-fixture", 200)
		if bytes.Contains(body, []byte(hq["key"])) {
			t.Fatal("probe key exposed in inventory")
		}
		if err := json.Unmarshal(body, &data); err != nil {
			t.Fatal(err)
		}
		return data
	}
	before := snapshot()
	if len(before.Devices) != 2 || len(before.Probes) != 2 || before.Devices[0].ID == before.Devices[1].ID {
		t.Fatalf("sites did not keep unique device identities: %#v", before)
	}
	device := before.Devices[0]
	if device.CompanyID == nil || *device.CompanyID != company.ID {
		t.Fatalf("device did not inherit company: %#v", device)
	}
	request("PUT", "/api/management/devices/"+device.ID+"/company", `{"override":true,"companyId":null}`, "", "", 204)
	after := snapshot().Devices[0]
	if after.CompanyID != nil || !after.CompanyOverride {
		t.Fatalf("explicit unassignment failed: %#v", after)
	}

	rotated := request("POST", "/api/management/probes/"+hq["id"]+"/rotate-key", `{}`, "", "", 200)
	var newKey map[string]string
	if err := json.Unmarshal(rotated, &newKey); err != nil {
		t.Fatal(err)
	}
	request("POST", "/probe/heartbeat", `{}`, "X-Probe-Key", hq["key"], 401)
	request("POST", "/probe/heartbeat", `{}`, "X-Probe-Key", newKey["key"], 200)
}
