package model

import "time"

type PortObservation struct {
	Port    int    `json:"port"`
	Service string `json:"service"`
}

type HostObservation struct {
	IP         string            `json:"ip"`
	Hostname   string            `json:"hostname,omitempty"`
	Alive      bool              `json:"alive"`
	OpenPorts  []PortObservation `json:"open_ports"`
	DeviceType string            `json:"device_type"`
	FirstSeen  time.Time         `json:"first_seen"`
	LastUpdate time.Time         `json:"last_updated"`
}
