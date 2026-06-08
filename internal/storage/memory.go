package storage

import (
	"sync"

	"github.com/Spillers-Technology/netviz/internal/model"
)

type MemoryStore struct {
	mu     sync.RWMutex
	events []model.ScanEvent
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{}
}

func (s *MemoryStore) Append(event model.ScanEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, event)
}

func (s *MemoryStore) Events() []model.ScanEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()
	events := make([]model.ScanEvent, len(s.events))
	copy(events, s.events)
	return events
}
