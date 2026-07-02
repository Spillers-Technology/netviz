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

	"github.com/Spillers-Technology/netviz/internal/probeconfig"
	"github.com/kardianos/service"
)

const (
	envURL = "NETVIZ_ANCHORDESK_URL"
	envKey = "NETVIZ_ANCHORDESK_KEY"

	serviceName        = "netviz-probe"
	serviceDisplayName = "NetViz Probe"
)

type probeConfig struct {
	cidr     string
	url      string
	key      string
	interval time.Duration
	once     bool
	config   string
}

func parseProbeConfig(command string, args []string) (probeConfig, error) {
	flags := flag.NewFlagSet("netviz-probe "+command, flag.ContinueOnError)
	var cfg probeConfig
	flags.StringVar(&cfg.cidr, "cidr", "", "IPv4 CIDR to scan, for example 192.168.1.0/24")
	flags.StringVar(&cfg.url, "url", "", "AnchorDesk base URL (or "+envURL+")")
	flags.StringVar(&cfg.key, "key", "", "AnchorDesk probe API key (or "+envKey+")")
	flags.DurationVar(&cfg.interval, "interval", 0, "heartbeat and continuous re-scan interval")
	flags.BoolVar(&cfg.once, "once", false, "scan once, push, and exit instead of running continuously")
	flags.StringVar(&cfg.config, "config", "", "path to probe JSON config")
	if err := flags.Parse(args); err != nil {
		return probeConfig{}, err
	}
	if flags.NArg() != 0 {
		return probeConfig{}, fmt.Errorf("unexpected arguments: %v", flags.Args())
	}

	set := map[string]bool{}
	flags.Visit(func(flag *flag.Flag) {
		set[flag.Name] = true
	})
	if cfg.config != "" {
		fileCfg, err := probeconfig.Load(cfg.config)
		if err != nil {
			return probeConfig{}, fmt.Errorf("read config %s: %w", cfg.config, err)
		}
		applyFileConfig(&cfg, fileCfg, set)
	}
	if cfg.url == "" {
		cfg.url = os.Getenv(envURL)
	}
	if cfg.key == "" {
		cfg.key = os.Getenv(envKey)
	}
	if cfg.interval <= 0 {
		cfg.interval = time.Minute
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
		return fmt.Errorf("AnchorDesk URL is required; use -url or set %s", envURL)
	}
	parsedURL, err := url.ParseRequestURI(c.url)
	if err != nil || parsedURL.Host == "" || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return fmt.Errorf("AnchorDesk URL must be an absolute http(s) URL: %q", c.url)
	}
	if c.key == "" {
		return fmt.Errorf("AnchorDesk probe key is required; use -key or set %s", envKey)
	}
	if c.interval <= 0 {
		return errors.New("interval must be greater than zero")
	}
	return nil
}

func (c probeConfig) fileConfig() probeconfig.Config {
	return probeconfig.Config{
		CIDR:          c.cidr,
		AnchorDeskURL: c.url,
		ProbeKey:      c.key,
		Interval:      c.interval.String(),
	}
}

func (c probeConfig) reload() (probeConfig, error) {
	if c.config == "" {
		return c, nil
	}
	fileCfg, err := probeconfig.Load(c.config)
	if err != nil {
		return probeConfig{}, err
	}
	next := c
	applyFileConfig(&next, fileCfg, nil)
	if next.interval <= 0 {
		next.interval = time.Minute
	}
	if err := next.validate(); err != nil {
		return probeConfig{}, err
	}
	return next, nil
}

func applyFileConfig(cfg *probeConfig, fileCfg probeconfig.Config, set map[string]bool) {
	if !set["cidr"] {
		cfg.cidr = fileCfg.CIDR
	}
	if !set["url"] {
		cfg.url = fileCfg.AnchorDeskURL
	}
	if !set["key"] {
		cfg.key = fileCfg.ProbeKey
	}
	if !set["interval"] {
		if interval, err := fileCfg.IntervalDuration(); err == nil {
			cfg.interval = interval
		}
	}
}

func serviceDefinition(cfg probeConfig) *service.Config {
	definition := &service.Config{
		Name:        serviceName,
		DisplayName: serviceDisplayName,
		Description: "Scans the local network and reports device inventory to AnchorDesk.",
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
	if cfg.config != "" {
		definition.Arguments = []string{
			"run",
			"-config=" + cfg.config,
		}
	} else if cfg.cidr != "" {
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
