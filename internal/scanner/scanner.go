package scanner

import (
	"context"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/spilloid/netviz/internal/model"
)

const (
	defaultTimeout     = 450 * time.Millisecond
	defaultConcurrency = 64
)

type ScanConfig struct {
	CIDR        string
	Ports       []int
	Timeout     time.Duration
	Concurrency int
}

type Scanner struct {
	config ScanConfig
}

func NewScanner(config ScanConfig) *Scanner {
	if config.Timeout <= 0 {
		config.Timeout = defaultTimeout
	}
	if config.Concurrency <= 0 {
		config.Concurrency = defaultConcurrency
	}
	return &Scanner{config: config}
}

func (s *Scanner) Scan(ctx context.Context) (<-chan model.ScanEvent, error) {
	hosts, err := ExpandCIDR(s.config.CIDR)
	if err != nil {
		return nil, err
	}
	ports, err := NormalizePorts(s.config.Ports)
	if err != nil {
		return nil, err
	}
	if len(hosts) == 0 {
		return nil, fmt.Errorf("CIDR %q produced no hosts", s.config.CIDR)
	}

	out := make(chan model.ScanEvent, 256)
	scanID := fmt.Sprintf("scan-%d", time.Now().UTC().UnixNano())

	go s.run(ctx, out, scanID, hosts, ports)
	return out, nil
}

func (s *Scanner) run(ctx context.Context, out chan<- model.ScanEvent, scanID string, hosts []string, ports []int) {
	defer close(out)

	started := newEvent(scanID, model.EventScanStarted)
	started.Message = "scan started"
	started.TotalHosts = len(hosts)
	if !emit(ctx, out, started) {
		return
	}

	workerCount := s.config.Concurrency
	if workerCount > len(hosts) {
		workerCount = len(hosts)
	}

	jobs := make(chan string)
	var checked atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ip := range jobs {
				s.scanHost(ctx, out, scanID, ip, ports, len(hosts), &checked)
			}
		}()
	}

	for _, host := range hosts {
		select {
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			finished := newEvent(scanID, model.EventScanFinished)
			finished.Message = "scan cancelled"
			finished.CheckedHosts = int(checked.Load())
			finished.TotalHosts = len(hosts)
			emit(context.Background(), out, finished)
			return
		case jobs <- host:
		}
	}

	close(jobs)
	wg.Wait()

	finished := newEvent(scanID, model.EventScanFinished)
	finished.Message = "scan finished"
	finished.CheckedHosts = int(checked.Load())
	finished.TotalHosts = len(hosts)
	emit(context.Background(), out, finished)
}

func (s *Scanner) scanHost(ctx context.Context, out chan<- model.ScanEvent, scanID string, ip string, ports []int, totalHosts int, checked *atomic.Int64) {
	now := time.Now().UTC()
	obs := model.HostObservation{
		IP:         ip,
		OpenPorts:  []model.PortObservation{},
		DeviceType: "unknown",
		FirstSeen:  now,
		LastUpdate: now,
	}

	seen := newEvent(scanID, model.EventHostSeen)
	seen.IP = ip
	seen.Host = cloneHost(obs)
	if !emit(ctx, out, seen) {
		return
	}

	if hostname := s.lookupHostname(ctx, ip); hostname != "" {
		obs.Hostname = hostname
		obs.LastUpdate = time.Now().UTC()
		event := newEvent(scanID, model.EventHostnameResolved)
		event.IP = ip
		event.Hostname = hostname
		event.Host = cloneHost(obs)
		if !emit(ctx, out, event) {
			return
		}
	}

	openPortInts := make([]int, 0)
	aliveEmitted := false
	for _, port := range ports {
		if ctx.Err() != nil {
			return
		}
		if s.isPortOpen(ctx, ip, port) {
			obs.Alive = true
			obs.LastUpdate = time.Now().UTC()
			if !aliveEmitted {
				alive := newEvent(scanID, model.EventHostAlive)
				alive.IP = ip
				alive.Host = cloneHost(obs)
				if !emit(ctx, out, alive) {
					return
				}
				aliveEmitted = true
			}

			portObs := model.PortObservation{Port: port, Service: ServiceName(port)}
			obs.OpenPorts = append(obs.OpenPorts, portObs)
			openPortInts = append(openPortInts, port)
			event := newEvent(scanID, model.EventPortOpen)
			event.IP = ip
			event.Port = &portObs
			event.Host = cloneHost(obs)
			if !emit(ctx, out, event) {
				return
			}
		}
	}

	obs.DeviceType = ClassifyDevice(openPortInts)
	obs.LastUpdate = time.Now().UTC()
	classified := newEvent(scanID, model.EventDeviceClassified)
	classified.IP = ip
	classified.DeviceType = obs.DeviceType
	classified.Host = cloneHost(obs)
	if !emit(ctx, out, classified) {
		return
	}

	doneCount := int(checked.Add(1))
	done := newEvent(scanID, model.EventHostDone)
	done.IP = ip
	done.Host = cloneHost(obs)
	done.CheckedHosts = doneCount
	done.TotalHosts = totalHosts
	emit(ctx, out, done)
}

func (s *Scanner) lookupHostname(ctx context.Context, ip string) string {
	resolver := net.DefaultResolver
	names, err := resolver.LookupAddr(ctx, ip)
	if err != nil || len(names) == 0 {
		return ""
	}
	return names[0]
}

func (s *Scanner) isPortOpen(ctx context.Context, ip string, port int) bool {
	dialer := net.Dialer{Timeout: s.config.Timeout}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(ip, fmt.Sprintf("%d", port)))
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func cloneHost(host model.HostObservation) *model.HostObservation {
	ports := make([]model.PortObservation, len(host.OpenPorts))
	copy(ports, host.OpenPorts)
	host.OpenPorts = ports
	return &host
}
