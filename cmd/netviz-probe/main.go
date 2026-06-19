// Command netviz-probe scans a LAN and pushes device records to a MaterialTicket
// backend. It runs the netviz scanner core, serializes results to the
// MaterialTicket probe contract, and POSTs them to /probe/devices while keeping
// the probe marked online via periodic /probe/heartbeat.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sort"
	"syscall"
	"time"

	"github.com/Spillers-Technology/netviz/internal/materialticket"
	"github.com/Spillers-Technology/netviz/internal/model"
	"github.com/Spillers-Technology/netviz/internal/scanner"
)

// Version is reported in heartbeats to MaterialTicket.
const Version = "0.1.0"

const (
	envURL = "NETVIZ_MATERIALTICKET_URL"
	envKey = "NETVIZ_MATERIALTICKET_KEY"

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
	flags := flag.NewFlagSet("netviz-probe", flag.ExitOnError)
	var (
		cidr     string
		url      string
		key      string
		interval time.Duration
		once     bool
	)
	flags.StringVar(&cidr, "cidr", "", "IPv4 CIDR to scan, for example 192.168.1.0/24")
	flags.StringVar(&url, "url", "", "MaterialTicket base URL (or "+envURL+")")
	flags.StringVar(&key, "key", "", "MaterialTicket probe API key (or "+envKey+")")
	flags.DurationVar(&interval, "interval", time.Minute, "heartbeat and continuous re-scan interval")
	flags.BoolVar(&once, "once", false, "scan once, push, and exit instead of running continuously")
	flags.Parse(args)

	if url == "" {
		url = os.Getenv(envURL)
	}
	if key == "" {
		key = os.Getenv(envKey)
	}

	if cidr == "" {
		return errors.New("CIDR is required; use -cidr 192.168.1.0/24")
	}
	if url == "" {
		return fmt.Errorf("MaterialTicket URL is required; use -url or set %s", envURL)
	}
	if key == "" {
		return fmt.Errorf("MaterialTicket probe key is required; use -key or set %s", envKey)
	}
	if interval <= 0 {
		interval = time.Minute
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	client := materialticket.NewClient(url, key, Version)

	// pending holds records from a scan whose push failed, so we retry on the
	// next cycle instead of dropping them.
	var pending []materialticket.DeviceRecord
	var backoff time.Duration

	if !once {
		go heartbeatLoop(ctx, client, cidr, interval)
	}

	scanAndPush := func() {
		hosts, err := scan(ctx, cidr)
		if err != nil {
			if ctx.Err() == nil {
				log.Printf("scan failed: %v", err)
			}
			return
		}
		records := materialticket.ToDeviceRecords(hosts)
		// Carry over anything we failed to deliver previously.
		records = mergeRecords(pending, records)

		result, err := client.SendDevices(ctx, records)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			pending = records
			backoff = nextBackoff(backoff)
			log.Printf("push failed (%d records held for retry): %v", len(records), err)
			return
		}
		pending = nil
		backoff = 0
		log.Printf("pushed %d devices: received=%d created=%d updated=%d", len(records), result.Received, result.Created, result.Updated)
		for _, e := range result.Errors {
			log.Printf("ingest error: %s", e)
		}
	}

	scanAndPush()
	if once {
		return nil
	}

	for {
		wait := interval
		if backoff > 0 && backoff < wait {
			wait = backoff
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(wait):
			scanAndPush()
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
func heartbeatLoop(ctx context.Context, client *materialticket.Client, cidr string, interval time.Duration) {
	if err := client.Heartbeat(ctx, "online", cidr); err != nil && ctx.Err() == nil {
		log.Printf("heartbeat failed: %v", err)
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := client.Heartbeat(ctx, "online", cidr); err != nil && ctx.Err() == nil {
				log.Printf("heartbeat failed: %v", err)
			}
		}
	}
}

// mergeRecords overlays fresh records on top of held-over ones, keyed by record
// ID, so a re-scan refreshes a device rather than duplicating it.
func mergeRecords(held, fresh []materialticket.DeviceRecord) []materialticket.DeviceRecord {
	if len(held) == 0 {
		return fresh
	}
	byID := make(map[string]materialticket.DeviceRecord, len(held)+len(fresh))
	order := make([]string, 0, len(held)+len(fresh))
	add := func(r materialticket.DeviceRecord) {
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
	merged := make([]materialticket.DeviceRecord, 0, len(order))
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
