package server

import (
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/Spillers-Technology/netviz/internal/anchordesk"
	"github.com/Spillers-Technology/netviz/internal/storage"
)

func (s *Server) managementInventory(w http.ResponseWriter, r *http.Request) {
	s.writeManagedInventory(w, r)
}

func (s *Server) exportInventory(w http.ResponseWriter, r *http.Request) {
	if s.inventoryKey == "" {
		writeError(w, http.StatusServiceUnavailable, "inventory sync is disabled")
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.inventoryKey)) != 1 {
		writeError(w, http.StatusUnauthorized, "invalid inventory key")
		return
	}
	s.writeManagedInventory(w, r)
}

func (s *Server) writeManagedInventory(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, "storage is not configured")
		return
	}
	inventory, err := s.store.ManagedInventory(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not read inventory")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, inventory)
}

func (s *Server) managedBody(w http.ResponseWriter, r *http.Request, input any) bool {
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, "storage is not configured")
		return false
	}
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "application/json is required")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	dec.DisallowUnknownFields()
	if err := dec.Decode(input); err != nil || dec.Decode(new(any)) != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid JSON payload")
		return false
	}
	return true
}

func validLabel(value string, max int) bool {
	return value != "" && utf8.RuneCountInString(value) <= max
}

func writeManagementError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, sql.ErrNoRows):
		writeError(w, http.StatusNotFound, "record not found")
	case errors.Is(err, storage.ErrUnknownCompany):
		writeError(w, http.StatusBadRequest, err.Error())
	case strings.Contains(err.Error(), "UNIQUE constraint failed"):
		writeError(w, http.StatusConflict, "a record with that name already exists")
	default:
		writeError(w, http.StatusInternalServerError, "could not save inventory changes")
	}
}

func (s *Server) saveCompany(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name string `json:"name"`
	}
	if !s.managedBody(w, r, &input) {
		return
	}
	name := strings.TrimSpace(input.Name)
	if !validLabel(name, 150) {
		writeError(w, http.StatusBadRequest, "company name is required (150 characters maximum)")
		return
	}
	company := storage.ManagedCompany{ID: r.PathValue("id"), Name: name}
	create := company.ID == ""
	code := http.StatusOK
	if create {
		company.ID = newRunID()
		code = http.StatusCreated
	}
	if err := s.store.SaveManagedCompany(r.Context(), company, create); err != nil {
		writeManagementError(w, err)
		return
	}
	writeJSON(w, code, company)
}

func (s *Server) saveProbe(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name      string  `json:"name"`
		Site      string  `json:"site"`
		CompanyID *string `json:"companyId"`
	}
	if !s.managedBody(w, r, &input) {
		return
	}
	name, site := strings.TrimSpace(input.Name), strings.TrimSpace(input.Site)
	if !validLabel(name, 150) || !validLabel(site, 120) {
		writeError(w, http.StatusBadRequest, "probe name and site are required")
		return
	}
	probe := storage.ManagedProbe{ID: r.PathValue("id"), Name: name, Site: site, CompanyID: input.CompanyID}
	if probe.ID == "" {
		probe.ID = newRunID()
		key := "nv_probe_" + rand.Text()
		if err := s.store.SaveManagedProbe(r.Context(), probe, key); err != nil {
			writeManagementError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusCreated, map[string]string{"id": probe.ID, "key": key})
		return
	}
	if err := s.store.SaveManagedProbe(r.Context(), probe, ""); err != nil {
		writeManagementError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) rotateProbeKey(w http.ResponseWriter, r *http.Request) {
	var body struct{}
	if !s.managedBody(w, r, &body) {
		return
	}
	key := "nv_probe_" + rand.Text()
	if err := s.store.RotateManagedProbeKey(r.Context(), r.PathValue("id"), key); err != nil {
		writeManagementError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"key": key})
}

func (s *Server) assignDevice(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Override  *bool   `json:"override"`
		CompanyID *string `json:"companyId"`
	}
	if !s.managedBody(w, r, &input) {
		return
	}
	if input.Override == nil || (!*input.Override && input.CompanyID != nil) {
		writeError(w, http.StatusBadRequest, "select an explicit company or inherit the probe company")
		return
	}
	if err := s.store.SetDeviceCompany(r.Context(), r.PathValue("id"), *input.Override, input.CompanyID); err != nil {
		writeManagementError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Managed probes in different networks may report the same private IP.
// A usable MAC follows the device across probes; other ids are probe-local.
func managedDeviceID(probeID string, record anchordesk.DeviceRecord) string {
	mac, err := net.ParseMAC(record.MAC)
	if err == nil && len(mac) == 6 && mac.String() != "00:00:00:00:00:00" && mac.String() != "ff:ff:ff:ff:ff:ff" {
		return mac.String()
	}
	return probeID + ":" + record.ID
}

func managedDeviceObservations(probeID string, records []anchordesk.DeviceRecord) ([]storage.ManagedDevice, error) {
	devices := make([]storage.ManagedDevice, 0, len(records))
	for _, record := range records {
		record.ID = strings.TrimSpace(record.ID)
		if record.ID == "" {
			record.ID = strings.TrimSpace(record.MAC)
		}
		if record.ID == "" {
			record.ID = strings.TrimSpace(record.IP)
		}
		if !validLabel(record.ID, 100) {
			return nil, errors.New("each observation requires a device ID or IP address")
		}
		observation, err := json.Marshal(record)
		if err != nil {
			return nil, err
		}
		devices = append(devices, storage.ManagedDevice{ID: managedDeviceID(probeID, record), Observation: observation})
	}
	return devices, nil
}
