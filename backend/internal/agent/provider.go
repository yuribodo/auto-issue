package agent

import (
	"context"
	"fmt"

	"auto-issue/internal/config"
)

// ProviderRunner abstracts CLI-based agent execution.
type ProviderRunner interface {
	RunStreaming(ctx context.Context, workspacePath, mode, issuePrompt string) (<-chan AgentEvent, <-chan RunResult, error)
	Type() string
}

// ProviderConfig holds configuration for creating a provider.
type ProviderConfig struct {
	Type    string
	Model   string
	Timeout config.Duration
	Prompt  string
	GHToken string
	APIKeys map[string]string // "openai" -> key, "gemini" -> key
}

// NewProvider creates the appropriate ProviderRunner for the given agent type.
func NewProvider(cfg ProviderConfig) (ProviderRunner, error) {
	switch cfg.Type {
	case "claude-code":
		return newClaudeProvider(cfg), nil
	case "codex":
		return newCodexProvider(cfg), nil
	case "gemini":
		return newGeminiProvider(cfg), nil
	default:
		return nil, fmt.Errorf("unknown agent type: %s", cfg.Type)
	}
}
