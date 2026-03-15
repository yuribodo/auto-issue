package agent

import (
	"context"
	"strings"

	"auto-issue/internal/config"
)

// Runner executes the configured agent as a local subprocess.
// It delegates to ClaudeProvider for backward compatibility.
type Runner struct {
	provider ProviderRunner
	cfg      config.AgentConfig
	ghToken  string
}

func NewRunner(cfg config.AgentConfig, ghToken string) *Runner {
	provider := newClaudeProvider(ProviderConfig{
		Type:    cfg.Type,
		Model:   cfg.Model,
		Timeout: cfg.Timeout,
		Prompt:  cfg.Prompt,
		GHToken: ghToken,
	})
	return &Runner{provider: provider, cfg: cfg, ghToken: ghToken}
}

// Run executes the agent synchronously (backward compat wrapper).
func (r *Runner) Run(ctx context.Context, workspacePath string, mode string, issuePrompt string) (RunResult, error) {
	events, resultCh, err := r.RunStreaming(ctx, workspacePath, mode, issuePrompt)
	if err != nil {
		return RunResult{}, err
	}

	var outputParts []string
	for evt := range events {
		if evt.Type == EventText {
			outputParts = append(outputParts, evt.Content)
		}
	}

	result := <-resultCh
	if result.Output == "" {
		result.Output = strings.Join(outputParts, "")
	}
	return result, nil
}

// RunStreaming executes the agent and returns channels for streaming events and final result.
func (r *Runner) RunStreaming(ctx context.Context, workspacePath string, mode string, issuePrompt string) (<-chan AgentEvent, <-chan RunResult, error) {
	return r.provider.RunStreaming(ctx, workspacePath, mode, issuePrompt)
}

// command returns the CLI command name (kept for tests).
func (r *Runner) command() string {
	switch r.cfg.Type {
	case "claude-code":
		return "claude"
	default:
		return r.cfg.Type
	}
}

// buildStreamArgs returns CLI args (kept for tests).
func (r *Runner) buildStreamArgs(prompt string) []string {
	switch r.cfg.Type {
	case "claude-code":
		return []string{
			"-p", prompt,
			"--verbose",
			"--output-format", "stream-json",
			"--dangerously-skip-permissions",
			"--model", r.cfg.Model,
		}
	default:
		return []string{prompt}
	}
}

// buildPromptForRunner constructs the prompt (kept for tests).
func (r *Runner) buildPrompt(mode string, issuePrompt string) string {
	return buildPrompt(r.cfg.Prompt, mode, issuePrompt)
}
