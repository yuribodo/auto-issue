package agent

import "time"

type AgentEventType string

const (
	EventText   AgentEventType = "text"
	EventTool   AgentEventType = "tool"
	EventStatus AgentEventType = "status"
	EventPR     AgentEventType = "pr"
	EventCost   AgentEventType = "cost"
	EventError  AgentEventType = "error"
)

type AgentEvent struct {
	Type      AgentEventType `json:"type"`
	Timestamp time.Time      `json:"timestamp"`
	Prefix    string         `json:"prefix"`
	Content   string         `json:"content"`
}

type RunResult struct {
	Output   string
	ExitCode int
	Duration time.Duration
	PRURL    string
	CostUSD  float64
	Turns    int
}
