package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"
)

type claudeProvider struct {
	cfg ProviderConfig
}

func newClaudeProvider(cfg ProviderConfig) *claudeProvider {
	return &claudeProvider{cfg: cfg}
}

func (p *claudeProvider) Type() string { return "claude-code" }

func (p *claudeProvider) RunStreaming(ctx context.Context, workspacePath, mode, issuePrompt string) (<-chan AgentEvent, <-chan RunResult, error) {
	prompt := buildPrompt(p.cfg.Prompt, mode, issuePrompt)

	ctx, cancel := context.WithTimeout(ctx, p.cfg.Timeout.Duration)

	args := []string{
		"-p", prompt,
		"--verbose",
		"--output-format", "stream-json",
		"--dangerously-skip-permissions",
		"--model", p.cfg.Model,
	}

	env := baseEnv(p.cfg.GHToken)

	// Try PTY first; fall back to direct spawn (e.g. on Windows).
	var reader io.ReadCloser
	var cmd *exec.Cmd

	ptmx, ptCmd, ptErr := spawnWithPTY(ctx, "claude", args, workspacePath, env)
	if ptErr == nil {
		reader = ptmx
		cmd = ptCmd
	} else {
		directCmd, dirErr := spawnDirect(ctx, "claude", args, workspacePath, env)
		if dirErr != nil {
			cancel()
			return nil, nil, dirErr
		}
		stdout, pipeErr := directCmd.StdoutPipe()
		if pipeErr != nil {
			cancel()
			return nil, nil, fmt.Errorf("creating stdout pipe: %w", pipeErr)
		}
		if startErr := directCmd.Start(); startErr != nil {
			cancel()
			return nil, nil, fmt.Errorf("starting agent: %w", startErr)
		}
		reader = stdout
		cmd = directCmd
	}

	eventCh := make(chan AgentEvent, 256)
	resultCh := make(chan RunResult, 1)

	go func() {
		defer cancel()
		defer close(eventCh)
		defer close(resultCh)
		defer reader.Close()

		start := time.Now()
		result := RunResult{}
		tb := newTextBufferer(ctx, eventCh)

		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			if strings.TrimSpace(line) == "" {
				continue
			}

			var parsed map[string]any
			if err := json.Unmarshal([]byte(line), &parsed); err != nil {
					select {
				case eventCh <- AgentEvent{Type: EventText, Timestamp: time.Now(), Prefix: "INFO", Content: strings.TrimSpace(line)}:
				case <-ctx.Done():
				}
				if match := prRegex.FindString(line); match != "" {
					result.PRURL = match
					select {
					case eventCh <- AgentEvent{Type: EventPR, Timestamp: time.Now(), Prefix: "PR", Content: match}:
					case <-ctx.Done():
					}
				}
				continue
			}

			msgType, _ := parsed["type"].(string)

			switch msgType {
			case "stream_event":
				evt, _ := parsed["event"].(map[string]any)
				if evt == nil {
					continue
				}
				evtType, _ := evt["type"].(string)
				if evtType == "content_block_delta" {
					delta, _ := evt["delta"].(map[string]any)
					if delta != nil {
						deltaType, _ := delta["type"].(string)
						if deltaType == "text_delta" {
							text, _ := delta["text"].(string)
							if text != "" {
								tb.Append(text)
							}
						}
					}
				}

			case "assistant":
				tb.Flush()
				msg, _ := parsed["message"].(map[string]any)
				if msg == nil {
					continue
				}
				content, _ := msg["content"].([]any)
				for _, block := range content {
					b, _ := block.(map[string]any)
					if b == nil {
						continue
					}
					blockType, _ := b["type"].(string)

					if blockType == "text" {
						text, _ := b["text"].(string)
						if match := prRegex.FindString(text); match != "" {
							result.PRURL = match
							select {
							case eventCh <- AgentEvent{Type: EventPR, Timestamp: time.Now(), Prefix: "PR", Content: match}:
							case <-ctx.Done():
							}
						}
					} else if blockType == "tool_use" {
						result.Turns++
						name, _ := b["name"].(string)
						input, _ := b["input"].(map[string]any)
						verb := toolVerb(name)
						detail := formatToolUse(name, input, workspacePath)
						select {
						case eventCh <- AgentEvent{Type: EventTool, Timestamp: time.Now(), Prefix: verb, Content: detail}:
						case <-ctx.Done():
						}
					}
				}

			case "result":
				tb.Flush()
				if cost, ok := parsed["total_cost_usd"].(float64); ok {
					result.CostUSD = cost
				}
				isError, _ := parsed["is_error"].(bool)
				var summary string
				if isError {
					resultText, _ := parsed["result"].(string)
					if len(resultText) > 200 {
						resultText = resultText[:200]
					}
					summary = resultText
					select {
					case eventCh <- AgentEvent{Type: EventError, Timestamp: time.Now(), Prefix: "FAIL", Content: summary}:
					case <-ctx.Done():
					}
				} else {
					summary = fmt.Sprintf("%d turns · $%.2f", result.Turns, result.CostUSD)
					select {
					case eventCh <- AgentEvent{Type: EventStatus, Timestamp: time.Now(), Prefix: "DONE", Content: summary}:
					case <-ctx.Done():
					}
				}
				if resultText, ok := parsed["result"].(string); ok {
					result.Output = resultText
				}

			case "system":
				subtype, _ := parsed["subtype"].(string)
				if subtype == "init" {
					model, _ := parsed["model"].(string)
					if model == "" {
						model = "agent"
					}
					select {
					case eventCh <- AgentEvent{Type: EventStatus, Timestamp: time.Now(), Prefix: "INIT", Content: model}:
					case <-ctx.Done():
					}
				}
			}
		}

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
