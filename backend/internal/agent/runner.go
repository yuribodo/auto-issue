package agent

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"time"

	"auto-issue/internal/config"
)

type RunResult struct {
	Output   string
	ExitCode int
	Duration time.Duration
}

// Runner executes the configured agent as a local subprocess.
type Runner struct {
	cfg config.AgentConfig
}

func NewRunner(cfg config.AgentConfig) *Runner {
	return &Runner{cfg: cfg}
}

// Run executes the agent in the given workspace directory.
// mode is either "developing" or "code_reviewing".
// issuePrompt contains the issue description and any feedback context.
func (r *Runner) Run(ctx context.Context, workspacePath string, mode string, issuePrompt string) (RunResult, error) {
	prompt := r.buildPrompt(mode, issuePrompt)

	ctx, cancel := context.WithTimeout(ctx, r.cfg.Timeout.Duration)
	defer cancel()

	args := r.buildArgs(prompt)
	cmd := exec.CommandContext(ctx, r.command(), args...)
	cmd.Dir = workspacePath

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err := cmd.Run()
	duration := time.Since(start)

	result := RunResult{
		Output:   stdout.String(),
		Duration: duration,
	}

	if cmd.ProcessState != nil {
		result.ExitCode = cmd.ProcessState.ExitCode()
	}

	if ctx.Err() == context.DeadlineExceeded {
		return result, fmt.Errorf("agent timed out after %s", r.cfg.Timeout.Duration)
	}

	if err != nil {
		// Include stderr in error for debugging
		return result, fmt.Errorf("agent exited with code %d: %s: %w", result.ExitCode, stderr.String(), err)
	}

	return result, nil
}

func (r *Runner) command() string {
	switch r.cfg.Type {
	case "claude-code":
		return "claude"
	default:
		return r.cfg.Type
	}
}

func (r *Runner) buildArgs(prompt string) []string {
	switch r.cfg.Type {
	case "claude-code":
		args := []string{
			"--print", prompt,
			"--model", r.cfg.Model,
		}
		return args
	default:
		return []string{prompt}
	}
}

func (r *Runner) buildPrompt(mode string, issuePrompt string) string {
	var systemCtx string
	if r.cfg.Prompt != "" {
		systemCtx = r.cfg.Prompt + "\n\n"
	}

	switch mode {
	case "developing":
		return fmt.Sprintf("%s%s", systemCtx, issuePrompt)
	case "code_reviewing":
		return fmt.Sprintf("%sReview the solution you just implemented for the following issue. Check for bugs, edge cases, code quality, and test coverage. If you find issues, fix them in-place.\n\nOriginal issue:\n%s", systemCtx, issuePrompt)
	default:
		return fmt.Sprintf("%s%s", systemCtx, issuePrompt)
	}
}
