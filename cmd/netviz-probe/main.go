// Command netviz-probe scans a LAN and pushes device records to an AnchorDesk
// backend. It runs the netviz scanner core, serializes results to the
// AnchorDesk probe contract, and POSTs them to /probe/devices while keeping
// the probe marked online via periodic /probe/heartbeat.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sort"
	"syscall"
	"time"

	"github.com/Spillers-Technology/netviz/internal/anchordesk"
	"github.com/Spillers-Technology/netviz/internal/model"
	"github.com/Spillers-Technology/netviz/internal/scanner"
	"github.com/Spillers-Technology/netviz/internal/version"
	"github.com/kardianos/service"
)

// Version is reported in heartbeats to AnchorDesk.
const Version = version.Version

const (
	retryBaseDelay = 5 * time.Second
	retryMaxDelay  = 5 * time.Minute
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	action := "run"
	if len(args) > 0 && isCommand(args[0]) {
		action = args[0]
		args = args[1:]
	}

	switch action {
	case "version":
		fmt.Println(Version)
		return nil
	case "install":
		cfg, err := parseProbeConfig(action, args)
		if err != nil {
			return err
		}
		if cfg.once {
			return fmt.Errorf("-once cannot be used when installing the service")
		}
		return controlService(action, cfg)
	case "start", "stop", "restart", "status", "uninstall":
		if len(args) != 0 {
			return fmt.Errorf("%s does not accept probe flags; reinstall to change service configuration", action)
		}
		return controlService(action, probeConfig{})
	case "run":
		cfg, err := parseProbeConfig(action, args)
		if err != nil {
			return err
		}
		return runConfigured(cfg)
	default:
		return fmt.Errorf("unknown command %q", action)
	}
}

func isCommand(value string) bool {
	switch value {
	case "run", "install", "uninstall", "start", "stop", "restart", "status", "version":
		return true
	default:
		return false
	}
}

func runConfigured(cfg probeConfig) error {
	program := &probeProgram{cfg: cfg}
	svc, err := service.New(program, serviceDefinition(cfg))
	if err != nil {
		return fmt.Errorf("create service: %w", err)
	}

	if !cfg.once && !service.Interactive() {
		return svc.Run()
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runProbe(ctx, cfg, log.Printf)
}

func runProbe(ctx context.Context, cfg probeConfig, logf func(string, ...any)) error {
	// pending holds records from a scan whose push failed, so we retry on the
	// next cycle instead of dropping them.
	var delivery deliveryState
	var inventory inventoryState

	scanAndPush := func(active probeConfig) error {
		client := anchordesk.NewClient(active.url, active.key, Version)
		if !active.once {
			if err := client.Heartbeat(ctx, "online", active.cidr); err != nil {
				if ctx.Err() == nil {
					logf("heartbeat failed: %v", err)
				}
			} else {
				logf("heartbeat sent: status=online cidr=%s version=%s", active.cidr, Version)
			}
		}

		hosts, err := scan(ctx, active.cidr)
		if err != nil {
			return fmt.Errorf("scan failed: %w", err)
		}
		records := inventory.records(hosts)
		if len(records) == 0 && len(delivery.pending) == 0 {
			logf("scan found no reportable devices")
			return nil
		}
		result, sent, err := delivery.send(ctx, client, records)
		if err != nil {
			return fmt.Errorf("push failed (%d records held for retry): %w", sent, err)
		}
		logf("pushed %d devices: received=%d created=%d updated=%d", sent, result.Received, result.Created, result.Updated)
		for _, e := range result.Errors {
			logf("ingest error: %s", e)
		}
		return nil
	}

	active, err := cfg.reload()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	err = scanAndPush(active)
	if cfg.once {
		return err
	}
	if err != nil && ctx.Err() == nil {
		logf("%v", err)
	}

	for {
		wait := active.interval
		if delivery.backoff > 0 && delivery.backoff < wait {
			wait = delivery.backoff
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(wait):
			next, err := cfg.reload()
			if err != nil {
				if ctx.Err() == nil {
					logf("load config: %v", err)
				}
				continue
			}
			active = next
			if err := scanAndPush(active); err != nil && ctx.Err() == nil {
				logf("%v", err)
			}
		}
	}
}

// scan runs a single scan and drains events into a deduplicated host map keyed
// by IP, mirroring the CLI's drain loop.
func scan(ctx context.Context, cidr string) ([]model.HostObservation, error) {
	s := scanner.NewScanner(scanner.ScanConfig{CIDR: cidr})
	events, err := s.Scan(ctx)
	if err != nil {
		return nil, err
	}

	results := map[string]model.HostObservation{}
	for event := range events {
		if event.Host != nil {
			results[event.Host.IP] = *event.Host
		}
	}

	hosts := make([]model.HostObservation, 0, len(results))
	for _, h := range results {
		h.OpenPorts = append([]model.PortObservation(nil), h.OpenPorts...)
		hosts = append(hosts, h)
	}
	sort.Slice(hosts, func(i, j int) bool { return hosts[i].IP < hosts[j].IP })
	return hosts, nil
}

// heartbeatLoop reports liveness on a fixed interval until the context is done.
func heartbeatLoop(ctx context.Context, client *anchordesk.Client, cidr string, interval time.Duration, logf func(string, ...any)) {
	send := func() {
		if err := client.Heartbeat(ctx, "online", cidr); err != nil {
			if ctx.Err() == nil {
				logf("heartbeat failed: %v", err)
			}
			return
		}
		logf("heartbeat sent: status=online cidr=%s version=%s", cidr, Version)
	}
	send()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			send()
		}
	}
}

type deviceSender interface {
	SendDevices(context.Context, []anchordesk.DeviceRecord) (anchordesk.IngestResult, error)
}

type deliveryState struct {
	pending []anchordesk.DeviceRecord
	backoff time.Duration
}

func (d *deliveryState) send(ctx context.Context, sender deviceSender, fresh []anchordesk.DeviceRecord) (anchordesk.IngestResult, int, error) {
	records := mergeRecords(d.pending, fresh)
	result, err := sender.SendDevices(ctx, records)
	if err != nil {
		d.pending = records
		d.backoff = nextBackoff(d.backoff)
		return anchordesk.IngestResult{}, len(records), err
	}
	d.pending = nil
	d.backoff = 0
	return result, len(records), nil
}

// mergeRecords overlays fresh records on top of held-over ones, keyed by record
// ID, so a re-scan refreshes a device rather than duplicating it.
func mergeRecords(held, fresh []anchordesk.DeviceRecord) []anchordesk.DeviceRecord {
	if len(held) == 0 {
		return fresh
	}
	byID := make(map[string]anchordesk.DeviceRecord, len(held)+len(fresh))
	order := make([]string, 0, len(held)+len(fresh))
	add := func(r anchordesk.DeviceRecord) {
		if _, ok := byID[r.ID]; !ok {
			order = append(order, r.ID)
		}
		byID[r.ID] = r
	}
	for _, r := range held {
		add(r)
	}
	for _, r := range fresh {
		add(r)
	}
	merged := make([]anchordesk.DeviceRecord, 0, len(order))
	for _, id := range order {
		merged = append(merged, byID[id])
	}
	return merged
}

func nextBackoff(current time.Duration) time.Duration {
	if current <= 0 {
		return retryBaseDelay
	}
	next := current * 2
	if next > retryMaxDelay {
		return retryMaxDelay
	}
	return next
}
