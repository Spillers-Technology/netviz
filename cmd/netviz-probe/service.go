package main

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/kardianos/service"
)

type probeProgram struct {
	cfg probeConfig

	mu     sync.Mutex
	cancel context.CancelFunc
	done   chan struct{}
}

func (p *probeProgram) Start(s service.Service) error {
	logger, err := s.Logger(nil)
	if err != nil {
		return fmt.Errorf("open service logger: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	p.mu.Lock()
	p.cancel = cancel
	p.done = done
	p.mu.Unlock()

	go func() {
		defer close(done)
		err := runProbe(ctx, p.cfg, func(format string, args ...any) {
			_ = logger.Infof(format, args...)
		})
		if err != nil && ctx.Err() == nil {
			_ = logger.Errorf("probe stopped: %v", err)
		}
	}()
	return nil
}

func (p *probeProgram) Stop(service.Service) error {
	p.mu.Lock()
	cancel := p.cancel
	done := p.done
	p.mu.Unlock()

	if cancel == nil {
		return nil
	}
	cancel()
	select {
	case <-done:
		return nil
	case <-time.After(10 * time.Second):
		return errors.New("timed out waiting for probe shutdown")
	}
}

func controlService(action string, cfg probeConfig) error {
	program := &probeProgram{cfg: cfg}
	svc, err := service.New(program, serviceDefinition(cfg))
	if err != nil {
		return fmt.Errorf("create service: %w", err)
	}

	if action == "status" {
		status, err := svc.Status()
		if err != nil {
			return fmt.Errorf("read %s status: %w", serviceName, err)
		}
		fmt.Printf("%s: %s\n", serviceName, statusText(status))
		return nil
	}

	if err := service.Control(svc, action); err != nil {
		return err
	}
	fmt.Printf("%s: %s complete\n", serviceName, action)
	return nil
}

func statusText(status service.Status) string {
	switch status {
	case service.StatusRunning:
		return "running"
	case service.StatusStopped:
		return "stopped"
	default:
		return "unknown"
	}
}
