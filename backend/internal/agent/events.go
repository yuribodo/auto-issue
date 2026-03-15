package agent

import "time"

// AgentEventType represents the type of streaming event from the agent.
type AgentEventType string

const (
	EventText   AgentEventType = "text"
	EventTool   AgentEventType = "tool"
	EventStatus AgentEventType = "status"
	EventPR     AgentEventType = "pr"
	EventCost   AgentEventType = "cost"
	EventError  AgentEventType = "error"
)

// AgentEvent represents a single streaming event emitted during agent execution.
type AgentEvent struct {
	Type      AgentEventType `json:"type"`
	Timestamp time.Time      `json:"timestamp"`
	Prefix    string         `json:"prefix"`
	Content   string         `json:"content"`
}

// RunResult contains the outcome of an agent execution.
type RunResult struct {
	Output   string
	ExitCode int
	Duration time.Duration
	PRURL    string
	CostUSD  float64
	Turns    int
}
