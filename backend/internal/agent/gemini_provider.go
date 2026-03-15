package agent

import (
	"bufio"
	"context"
	"fmt"
	"strings"
	"time"
)

type geminiProvider struct {
	cfg ProviderConfig
}

func newGeminiProvider(cfg ProviderConfig) *geminiProvider {
	return &geminiProvider{cfg: cfg}
}

func (p *geminiProvider) Type() string { return "gemini" }

func (p *geminiProvider) RunStreaming(ctx context.Context, workspacePath, mode, issuePrompt string) (<-chan AgentEvent, <-chan RunResult, error) {
	prompt := buildPrompt(p.cfg.Prompt, mode, issuePrompt)

	ctx, cancel := context.WithTimeout(ctx, p.cfg.Timeout.Duration)

	args := []string{"-p", prompt}

	env := baseEnv(p.cfg.GHToken)
	if key := p.cfg.APIKeys["gemini"]; key != "" {
		env = append(env, "GOOGLE_API_KEY="+key)
	}

	cmd, err := spawnDirect(ctx, "gemini", args, workspacePath, env)
	if err != nil {
		cancel()
		return nil, nil, err
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, nil, fmt.Errorf("creating stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return nil, nil, fmt.Errorf("creating stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, nil, fmt.Errorf("starting gemini: %w", err)
	}

	eventCh := make(chan AgentEvent, 256)
	resultCh := make(chan RunResult, 1)

	go func() {
		defer cancel()
		defer close(eventCh)
		defer close(resultCh)

		start := time.Now()
		result := RunResult{}
		var outputLines []string

		go func() {
			s := bufio.NewScanner(stderr)
			for s.Scan() {
				line := s.Text()
				if line != "" {
					select {
					case eventCh <- AgentEvent{Type: EventText, Timestamp: time.Now(), Prefix: "ERR", Content: line}:
					case <-ctx.Done():
						return
					}
				}
			}
		}()

		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			if strings.TrimSpace(line) == "" {
				continue
			}

			trimmed := strings.TrimSpace(line)
			outputLines = append(outputLines, trimmed)

			select {
			case eventCh <- AgentEvent{Type: EventText, Timestamp: time.Now(), Prefix: "AGENT", Content: trimmed}:
			case <-ctx.Done():
				break
			}

			if match := prRegex.FindString(line); match != "" {
				result.PRURL = match
				select {
				case eventCh <- AgentEvent{Type: EventPR, Timestamp: time.Now(), Prefix: "PR", Content: match}:
				case <-ctx.Done():
				}
			}
		}

		result.Output = strings.Join(outputLines, "\n")

		cmdErr := cmd.Wait()
		result.Duration = time.Since(start)

		if cmd.ProcessState != nil {
			result.ExitCode = cmd.ProcessState.ExitCode()
		}

		if ctx.Err() == context.DeadlineExceeded {
			select {
			case eventCh <- AgentEvent{Type: EventError, Timestamp: time.Now(), Prefix: "TIMEOUT", Content: fmt.Sprintf("agent timed out after %s", p.cfg.Timeout.Duration)}:
			default:
			}
		} else if cmdErr != nil {
			select {
			case eventCh <- AgentEvent{Type: EventError, Timestamp: time.Now(), Prefix: "ERR", Content: fmt.Sprintf("agent exited with code %d", result.ExitCode)}:
			default:
			}
		}

		resultCh <- result
	}()

	return eventCh, resultCh, nil
}
