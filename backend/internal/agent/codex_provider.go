package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type codexProvider struct {
	cfg ProviderConfig
}

func newCodexProvider(cfg ProviderConfig) *codexProvider {
	return &codexProvider{cfg: cfg}
}

func (p *codexProvider) Type() string { return "codex" }

func (p *codexProvider) RunStreaming(ctx context.Context, workspacePath, mode, issuePrompt string) (<-chan AgentEvent, <-chan RunResult, error) {
	prompt := buildPrompt(p.cfg.Prompt, mode, issuePrompt)

	ctx, cancel := context.WithTimeout(ctx, p.cfg.Timeout.Duration)

	args := []string{"exec", "--full-auto", "--json"}
	if p.cfg.Model != "" {
		args = append(args, "--model", p.cfg.Model)
	}
	args = append(args, prompt)

	env := baseEnv(p.cfg.GHToken)
	if key := p.cfg.APIKeys["openai"]; key != "" {
		env = append(env, "OPENAI_API_KEY="+key)
	}

	cmd, err := spawnDirect(ctx, "codex", args, workspacePath, env)
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
		return nil, nil, fmt.Errorf("starting codex: %w", err)
	}

	eventCh := make(chan AgentEvent, 256)
	resultCh := make(chan RunResult, 1)

	go func() {
		defer cancel()
		defer close(eventCh)
		defer close(resultCh)

		start := time.Now()
		result := RunResult{}
		var outputParts []string

		// Read stderr in background
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

			// Try to parse as Codex JSONL
			var parsed map[string]any
			if err := json.Unmarshal([]byte(line), &parsed); err != nil {
				// Not JSON — emit as plain text, check for PR URL
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
			case "thread.started":
				select {
				case eventCh <- AgentEvent{Type: EventStatus, Timestamp: time.Now(), Prefix: "INIT", Content: "codex"}:
				case <-ctx.Done():
				}

			case "turn.started":
				result.Turns++

			case "item.completed":
				item, _ := parsed["item"].(map[string]any)
				if item == nil {
					continue
				}
				itemType, _ := item["type"].(string)

				switch itemType {
				case "agent_message":
					text, _ := item["text"].(string)
					if text != "" {
						outputParts = append(outputParts, text)
						select {
						case eventCh <- AgentEvent{Type: EventText, Timestamp: time.Now(), Prefix: "AGENT", Content: text}:
						case <-ctx.Done():
						}
						if match := prRegex.FindString(text); match != "" {
							result.PRURL = match
							select {
							case eventCh <- AgentEvent{Type: EventPR, Timestamp: time.Now(), Prefix: "PR", Content: match}:
							case <-ctx.Done():
							}
						}
					}

				case "command_execution":
					command, _ := item["command"].(string)
					status, _ := item["status"].(string)
					if command != "" && status == "completed" {
						// Shorten the command for display
						short := command
						if strings.HasPrefix(short, "/usr/bin/bash -lc ") {
							short = strings.TrimPrefix(short, "/usr/bin/bash -lc ")
							short = strings.Trim(short, "'\"")
						}
						if len(short) > 120 {
							short = short[:120]
						}
						select {
						case eventCh <- AgentEvent{Type: EventTool, Timestamp: time.Now(), Prefix: "EXEC", Content: short}:
						case <-ctx.Done():
						}
						// Check aggregated output for PR URLs
						output, _ := item["aggregated_output"].(string)
						if match := prRegex.FindString(output); match != "" {
							result.PRURL = match
							select {
							case eventCh <- AgentEvent{Type: EventPR, Timestamp: time.Now(), Prefix: "PR", Content: match}:
							case <-ctx.Done():
							}
						}
					}

				case "file_edit", "file_create", "file_delete":
					filePath, _ := item["file_path"].(string)
					if filePath == "" {
						filePath, _ = item["path"].(string)
					}
					short := strings.ReplaceAll(filePath, workspacePath+"/", "")
					verb := "EDIT"
					if itemType == "file_create" {
						verb = "WRITE"
					} else if itemType == "file_delete" {
						verb = "DEL"
					}
					select {
					case eventCh <- AgentEvent{Type: EventTool, Timestamp: time.Now(), Prefix: verb, Content: short}:
					case <-ctx.Done():
					}
				}

			case "thread.completed":
				summary := fmt.Sprintf("%d turns", result.Turns)
				select {
				case eventCh <- AgentEvent{Type: EventStatus, Timestamp: time.Now(), Prefix: "DONE", Content: summary}:
				case <-ctx.Done():
				}

			case "error":
				errMsg, _ := parsed["message"].(string)
				if errMsg == "" {
					errMsg = "unknown error"
				}
				select {
				case eventCh <- AgentEvent{Type: EventError, Timestamp: time.Now(), Prefix: "FAIL", Content: errMsg}:
				case <-ctx.Done():
				}
			}
		}

		result.Output = strings.Join(outputParts, "\n")

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
