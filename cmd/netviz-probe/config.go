package main

import (
	"errors"
	"flag"
	"fmt"
	"net"
	"net/url"
	"os"
	"runtime"
	"time"

	"github.com/kardianos/service"
)

const (
	envURL = "NETVIZ_MATERIALTICKET_URL"
	envKey = "NETVIZ_MATERIALTICKET_KEY"

	serviceName        = "netviz-probe"
	serviceDisplayName = "NetViz Probe"
)

type probeConfig struct {
	cidr     string
	url      string
	key      string
	interval time.Duration
	once     bool
}

func parseProbeConfig(command string, args []string) (probeConfig, error) {
	flags := flag.NewFlagSet("netviz-probe "+command, flag.ContinueOnError)
	var cfg probeConfig
	flags.StringVar(&cfg.cidr, "cidr", "", "IPv4 CIDR to scan, for example 192.168.1.0/24")
	flags.StringVar(&cfg.url, "url", "", "MaterialTicket base URL (or "+envURL+")")
	flags.StringVar(&cfg.key, "key", "", "MaterialTicket probe API key (or "+envKey+")")
	flags.DurationVar(&cfg.interval, "interval", time.Minute, "heartbeat and continuous re-scan interval")
	flags.BoolVar(&cfg.once, "once", false, "scan once, push, and exit instead of running continuously")
	if err := flags.Parse(args); err != nil {
		return probeConfig{}, err
	}
	if flags.NArg() != 0 {
		return probeConfig{}, fmt.Errorf("unexpected arguments: %v", flags.Args())
	}

	if cfg.url == "" {
		cfg.url = os.Getenv(envURL)
	}
	if cfg.key == "" {
		cfg.key = os.Getenv(envKey)
	}
	if err := cfg.validate(); err != nil {
		return probeConfig{}, err
	}
	return cfg, nil
}

func (c probeConfig) validate() error {
	if c.cidr == "" {
		return errors.New("CIDR is required; use -cidr 192.168.1.0/24")
	}
	ip, _, err := net.ParseCIDR(c.cidr)
	if err != nil || ip.To4() == nil {
		return fmt.Errorf("CIDR must be a valid IPv4 network: %q", c.cidr)
	}
	if c.url == "" {
		return fmt.Errorf("MaterialTicket URL is required; use -url or set %s", envURL)
	}
	parsedURL, err := url.ParseRequestURI(c.url)
	if err != nil || parsedURL.Host == "" || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return fmt.Errorf("MaterialTicket URL must be an absolute http(s) URL: %q", c.url)
	}
	if c.key == "" {
		return fmt.Errorf("MaterialTicket probe key is required; use -key or set %s", envKey)
	}
	if c.interval <= 0 {
		return errors.New("interval must be greater than zero")
	}
	return nil
}

func serviceDefinition(cfg probeConfig) *service.Config {
	definition := &service.Config{
		Name:        serviceName,
		DisplayName: serviceDisplayName,
		Description: "Scans the local network and reports device inventory to MaterialTicket.",
		Option: service.KeyValue{
			"DelayedAutoStart":       true,
			"KeepAlive":              true,
			"OnFailure":              "restart",
			"OnFailureDelayDuration": "10s",
			"Restart":                "always",
			"RunAtLoad":              true,
			"StartType":              "automatic",
		},
	}
	if cfg.cidr != "" {
		definition.Arguments = []string{
			"run",
			"-cidr=" + cfg.cidr,
			"-interval=" + cfg.interval.String(),
		}
		definition.EnvVars = map[string]string{
			envURL: cfg.url,
			envKey: cfg.key,
		}
	}
	if runtime.GOOS == "linux" {
		definition.Dependencies = []string{
			"After=network-online.target",
			"Wants=network-online.target",
		}
	}
	return definition
}
