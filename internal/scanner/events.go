package scanner

import (
	"context"
	"time"

	"github.com/spilloid/netviz/internal/model"
)

func newEvent(scanID string, eventType model.ScanEventType) model.ScanEvent {
	return model.ScanEvent{
		Type:      eventType,
		ScanID:    scanID,
		Timestamp: time.Now().UTC(),
	}
}

func emit(ctx context.Context, out chan<- model.ScanEvent, event model.ScanEvent) bool {
	select {
	case <-ctx.Done():
		return false
	case out <- event:
		return true
	}
}
