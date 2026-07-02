package probeconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

const Version = 1

type Config struct {
	Version       int       `json:"version"`
	CIDR          string    `json:"cidr"`
	AnchorDeskURL string    `json:"anchordesk_url"`
	ProbeKey      string    `json:"probe_key"`
	Interval      string    `json:"interval"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func DefaultPath() (string, error) {
	switch runtime.GOOS {
	case "windows":
		if programData := os.Getenv("ProgramData"); programData != "" {
			return filepath.Join(programData, "NetViz", "probe.json"), nil
		}
	case "darwin":
		return filepath.Join(string(filepath.Separator), "Library", "Application Support", "NetViz", "probe.json"), nil
	default:
		return filepath.Join(string(filepath.Separator), "etc", "netviz", "probe.json"), nil
	}

	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "netviz", "probe.json"), nil
}

func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, err
	}
	if cfg.Version == 0 {
		cfg.Version = Version
	}
	return cfg.Normalized()
}

func Save(path string, cfg Config) error {
	cfg, err := cfg.Normalized()
	if err != nil {
		return err
	}
	cfg.Version = Version
	cfg.UpdatedAt = time.Now().UTC()

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o600)
}

func (c Config) Normalized() (Config, error) {
	if c.Interval == "" {
		c.Interval = time.Minute.String()
	}
	if err := c.Validate(); err != nil {
		return Config{}, err
	}
	return c, nil
}

func (c Config) Validate() error {
	if c.CIDR == "" {
		return errors.New("CIDR is required")
	}
	ip, _, err := net.ParseCIDR(c.CIDR)
	if err != nil || ip.To4() == nil {
		return fmt.Errorf("CIDR must be a valid IPv4 network: %q", c.CIDR)
	}
	if c.AnchorDeskURL == "" {
		return errors.New("AnchorDesk URL is required")
	}
	parsedURL, err := url.ParseRequestURI(c.AnchorDeskURL)
	if err != nil || parsedURL.Host == "" || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return fmt.Errorf("AnchorDesk URL must be an absolute http(s) URL: %q", c.AnchorDeskURL)
	}
	if c.ProbeKey == "" {
		return errors.New("probe API key is required")
	}
	interval, err := time.ParseDuration(c.Interval)
	if err != nil {
		return fmt.Errorf("interval must be a duration like 60s, 1m, or 5m: %w", err)
	}
	if interval <= 0 {
		return errors.New("interval must be greater than zero")
	}
	return nil
}

func (c Config) IntervalDuration() (time.Duration, error) {
	c, err := c.Normalized()
	if err != nil {
		return 0, err
	}
	return time.ParseDuration(c.Interval)
}
