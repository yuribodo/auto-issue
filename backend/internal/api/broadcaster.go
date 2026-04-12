package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"auto-issue/internal/agent"
)

type Broadcaster struct {
	mu   sync.RWMutex
	subs map[string]map[chan agent.AgentEvent]struct{}
}

func NewBroadcaster() *Broadcaster {
	return &Broadcaster{
		subs: make(map[string]map[chan agent.AgentEvent]struct{}),
	}
}

func (b *Broadcaster) Subscribe(issueID string) (<-chan agent.AgentEvent, func()) {
	ch := make(chan agent.AgentEvent, 64)

	b.mu.Lock()
	if b.subs[issueID] == nil {
		b.subs[issueID] = make(map[chan agent.AgentEvent]struct{})
	}
	b.subs[issueID][ch] = struct{}{}
	b.mu.Unlock()

	unsub := func() {
		b.mu.Lock()
		delete(b.subs[issueID], ch)
		if len(b.subs[issueID]) == 0 {
			delete(b.subs, issueID)
		}
		b.mu.Unlock()
		close(ch)
	}

	return ch, unsub
}

// Non-blocking: drops events for slow consumers.
func (b *Broadcaster) Broadcast(issueID string, event agent.AgentEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	for ch := range b.subs[issueID] {
		select {
		case ch <- event:
		default:
			// Drop event for slow consumer
		}
	}
}

func (b *Broadcaster) ServeSSE(w http.ResponseWriter, r *http.Request, issueID string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ch, unsub := b.Subscribe(issueID)
	defer unsub()

	fmt.Fprintf(w, ": connected\n\n")
	flusher.Flush()

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		case event, ok := <-ch:
			if !ok {
				return
			}
			data, err := json.Marshal(event)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, data)
			flusher.Flush()
		}
	}
}
