package agent

import (
	"context"
	"strings"

	"auto-issue/internal/config"
)

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

func (r *Runner) RunStreaming(ctx context.Context, workspacePath string, mode string, issuePrompt string) (<-chan AgentEvent, <-chan RunResult, error) {
	return r.provider.RunStreaming(ctx, workspacePath, mode, issuePrompt)
}

func (r *Runner) command() string {
	switch r.cfg.Type {
	case "claude-code":
		return "claude"
	default:
		return r.cfg.Type
	}
}

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

func (r *Runner) buildPrompt(mode string, issuePrompt string) string {
	return buildPrompt(r.cfg.Prompt, mode, issuePrompt)
}
