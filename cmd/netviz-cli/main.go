package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Spillers-Technology/netviz/internal/model"
	"github.com/Spillers-Technology/netviz/internal/scanner"
	"github.com/Spillers-Technology/netviz/internal/storage"
	"github.com/Spillers-Technology/netviz/internal/version"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "scan":
			return runScan(os.Args[2:])
		case "history":
			return runHistory(os.Args[2:])
		case "diff":
			return runDiff(os.Args[2:])
		case "version", "-version", "--version":
			fmt.Println("netviz-cli " + version.Version)
			return nil
		case "help", "-h", "--help":
			printUsage(os.Stdout)
			return nil
		}
	}
	return runScan(os.Args[1:])
}

func printUsage(w io.Writer) {
	fmt.Fprint(w, `netviz-cli — NetViz LAN scanner

Usage:
  netviz-cli scan -cidr 192.168.1.0/24 [-save] [-ports 22,80,443]
                                                 scan a network, stream JSON events
  netviz-cli history [-limit 20]                 list saved scan runs
  netviz-cli diff [-base ID -compare ID]         diff two runs (default: latest two)
  netviz-cli version                             print the version

A bare CIDR also works: netviz-cli 192.168.1.0/24
Only scan networks you own or are authorized to scan.
`)
}

// maxSelectedPorts matches the desktop's per-scan limit: the scanner stays a
// constrained LAN discovery tool, not a full port sweeper.
const maxSelectedPorts = 64

// parsePortList turns "80,443, 8080" into unique ports, preserving order.
// Range validation is left to scanner.NormalizePorts.
func parsePortList(text string) ([]int, error) {
	var ports []int
	seen := map[int]struct{}{}
	for _, token := range strings.Split(text, ",") {
		token = strings.TrimSpace(token)
		if token == "" {
			continue
		}
		port, err := strconv.Atoi(token)
		if err != nil {
			return nil, fmt.Errorf("invalid port %q in -ports", token)
		}
		if _, ok := seen[port]; ok {
			continue
		}
		seen[port] = struct{}{}
		ports = append(ports, port)
	}
	if len(ports) > maxSelectedPorts {
		return nil, fmt.Errorf("too many ports (%d); the limit is %d", len(ports), maxSelectedPorts)
	}
	return ports, nil
}

func runScan(args []string) error {
	flags := flag.NewFlagSet("scan", flag.ExitOnError)
	var cidr string
	var save bool
	var portsFlag string

	flags.StringVar(&cidr, "cidr", "", "IPv4 CIDR to scan, for example 192.168.1.0/24")
	flags.BoolVar(&save, "save", false, "save completed scan to local SQLite history")
	flags.StringVar(&portsFlag, "ports", "", "comma-separated TCP ports to probe instead of the defaults, for example 22,80,443")
	flags.Parse(args)

	if cidr == "" && flags.NArg() == 1 {
		cidr = flags.Arg(0)
	}
	if cidr == "" {
		return errors.New("CIDR is required; use -cidr 192.168.1.0/24 (netviz-cli help lists all commands)")
	}
	ports, err := parsePortList(portsFlag)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	s := scanner.NewScanner(scanner.ScanConfig{
		CIDR:  cidr,
		Ports: ports,
	})
	events, err := s.Scan(ctx)
	if err != nil {
		return err
	}

	encoder := json.NewEncoder(os.Stdout)
	results := map[string]model.HostObservation{}
	var run model.ScanRun
	for event := range events {
		switch event.Type {
		case model.EventScanStarted:
			run.ID = event.ScanID
			run.CIDR = cidr
			run.StartedAt = event.Timestamp
		case model.EventScanFinished:
			run.EndedAt = event.Timestamp
		}
		if event.Host != nil {
			results[event.Host.IP] = *event.Host
		}
		if err := encoder.Encode(event); err != nil {
			return err
		}
	}

	if save {
		hosts := hostsFromMap(results)
		if len(hosts) > 0 {
			store, err := openHistoryStore()
			if err != nil {
				return err
			}
			defer store.Close()
			if run.EndedAt.IsZero() {
				run.EndedAt = time.Now().UTC()
			}
			if err := store.SaveScanRun(context.Background(), run, hosts); err != nil {
				return err
			}
		}
	}
	return nil
}

func runHistory(args []string) error {
	flags := flag.NewFlagSet("history", flag.ExitOnError)
	limit := flags.Int("limit", 20, "maximum scan runs to print")
	flags.Parse(args)

	store, err := openHistoryStore()
	if err != nil {
		return err
	}
	defer store.Close()
	runs, err := store.ListScanRuns(context.Background(), *limit)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(runs)
}

func runDiff(args []string) error {
	flags := flag.NewFlagSet("diff", flag.ExitOnError)
	base := flags.String("base", "", "base scan run ID")
	compare := flags.String("compare", "", "compare scan run ID")
	flags.Parse(args)

	store, err := openHistoryStore()
	if err != nil {
		return err
	}
	defer store.Close()
	if *base != "" && *compare != "" {
		diff, err := store.DiffRuns(context.Background(), *base, *compare)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(diff)
	}
	diff, err := store.DiffLatest(context.Background())
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(diff)
}

func openHistoryStore() (*storage.SQLiteStore, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	return storage.OpenSQLite(filepath.Join(dir, "netviz", "history.db"))
}

func hostsFromMap(results map[string]model.HostObservation) []model.HostObservation {
	hosts := make([]model.HostObservation, 0, len(results))
	for _, host := range results {
		host.OpenPorts = append([]model.PortObservation(nil), host.OpenPorts...)
		hosts = append(hosts, host)
	}
	sort.Slice(hosts, func(i, j int) bool {
		return model.LessIP(hosts[i].IP, hosts[j].IP)
	})
	return hosts
}
