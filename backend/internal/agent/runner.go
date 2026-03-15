package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"auto-issue/internal/config"

	"github.com/creack/pty"
)

var prRegex = regexp.MustCompile(`https://github\.com/.+/pull/\d+`)

// Runner executes the configured agent as a local subprocess.
type Runner struct {
	cfg     config.AgentConfig
	ghToken string
}

func NewRunner(cfg config.AgentConfig, ghToken string) *Runner {
	return &Runner{cfg: cfg, ghToken: ghToken}
}

// Run executes the agent synchronously (backward compat wrapper).
func (r *Runner) Run(ctx context.Context, workspacePath string, mode string, issuePrompt string) (RunResult, error) {
	events, resultCh, err := r.RunStreaming(ctx, workspacePath, mode, issuePrompt)
	if err != nil {
		return RunResult{}, err
	}

	// Drain events
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
	prompt := r.buildPrompt(mode, issuePrompt)

	ctx, cancel := context.WithTimeout(ctx, r.cfg.Timeout.Duration)

	args := r.buildStreamArgs(prompt)
	cmd := exec.CommandContext(ctx, r.command(), args...)
	cmd.Dir = workspacePath

	// Inject GH_TOKEN into env
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("GH_TOKEN=%s", r.ghToken),
		fmt.Sprintf("GITHUB_TOKEN=%s", r.ghToken),
	)

	// Spawn with PTY to avoid buffering
	ptmx, err := pty.Start(cmd)
	if err != nil {
		cancel()
		return nil, nil, fmt.Errorf("starting agent with pty: %w", err)
	}

	eventCh := make(chan AgentEvent, 256)
	resultCh := make(chan RunResult, 1)

	go func() {
		defer cancel()
		defer close(eventCh)
		defer close(resultCh)
		defer ptmx.Close()

		start := time.Now()
		result := RunResult{}

		// Text buffering: accumulate deltas and flush on sentence boundaries or timeout
		var textBuf strings.Builder
		var textMu sync.Mutex
		flushTimer := time.NewTimer(400 * time.Millisecond)
		flushTimer.Stop()

		flushText := func() {
			textMu.Lock()
			defer textMu.Unlock()
			if textBuf.Len() == 0 {
				return
			}
			text := textBuf.String()
			textBuf.Reset()
			for _, line := range strings.Split(text, "\n") {
				trimmed := strings.TrimSpace(line)
				if trimmed != "" {
					select {
					case eventCh <- AgentEvent{Type: EventText, Timestamp: time.Now(), Prefix: "AGENT", Content: trimmed}:
					case <-ctx.Done():
						return
					}
				}
			}
		}

		appendTextDelta := func(text string) {
			textMu.Lock()
			textBuf.WriteString(text)
			hasBoundary := strings.ContainsAny(text, ".!?\n")
			textMu.Unlock()

			if hasBoundary {
				flushTimer.Stop()
				flushText()
			} else {
				flushTimer.Reset(400 * time.Millisecond)
			}
		}

		// Background goroutine for flush timer
		go func() {
			for {
				select {
				case <-flushTimer.C:
					flushText()
				case <-ctx.Done():
					return
				}
			}
		}()

		// Read stdout line by line
		scanner := bufio.NewScanner(ptmx)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB buffer

		for scanner.Scan() {
			line := scanner.Text()
			if strings.TrimSpace(line) == "" {
				continue
			}

			var parsed map[string]any
			if err := json.Unmarshal([]byte(line), &parsed); err != nil {
				// Not JSON — emit as raw log, check for PR URL
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
				// Incremental streaming — buffer text deltas
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
								appendTextDelta(text)
							}
						}
					}
				}

			case "assistant":
				// Full assistant message — handle tool_use blocks, detect PR
				flushText()
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
				flushText()
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
				// Capture result text as output
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

		// Wait for process to finish
		cmdErr := cmd.Wait()
		result.Duration = time.Since(start)

		if cmd.ProcessState != nil {
			result.ExitCode = cmd.ProcessState.ExitCode()
		}

		if ctx.Err() == context.DeadlineExceeded {
			select {
			case eventCh <- AgentEvent{Type: EventError, Timestamp: time.Now(), Prefix: "TIMEOUT", Content: fmt.Sprintf("agent timed out after %s", r.cfg.Timeout.Duration)}:
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

// toolVerb maps tool names to short action verbs.
func toolVerb(name string) string {
	verbs := map[string]string{
		"Read":      "READ",
		"Edit":      "EDIT",
		"Write":     "WRITE",
		"Bash":      "EXEC",
		"Glob":      "FIND",
		"Grep":      "SEARCH",
		"Agent":     "SPAWN",
		"TodoWrite": "PLAN",
		"TodoRead":  "PLAN",
		"WebFetch":  "FETCH",
		"WebSearch": "SEARCH",
	}
	if v, ok := verbs[name]; ok {
		return v
	}
	if len(name) > 6 {
		return strings.ToUpper(name[:6])
	}
	return strings.ToUpper(name)
}

// formatToolUse formats tool input into a concise description.
func formatToolUse(name string, input map[string]any, workspacePath string) string {
	shortPath := func(p string) string {
		s := strings.ReplaceAll(p, workspacePath+"/", "")
		s = strings.ReplaceAll(s, workspacePath, ".")
		return s
	}

	getString := func(key string) string {
		if v, ok := input[key].(string); ok {
			return v
		}
		return ""
	}

	switch name {
	case "Read":
		p := shortPath(getString("file_path"))
		if offset := getString("offset"); offset != "" {
			return fmt.Sprintf("%s:%s", p, offset)
		}
		return p
	case "Edit", "Write":
		return shortPath(getString("file_path"))
	case "Bash":
		cmd := shortPath(getString("command"))
		if len(cmd) > 120 {
			cmd = cmd[:120]
		}
		return cmd
	case "Glob":
		return getString("pattern")
	case "Grep":
		p := getString("pattern")
		path := getString("path")
		if path != "" {
			return fmt.Sprintf("%q in %s", p, shortPath(path))
		}
		return fmt.Sprintf("%q", p)
	case "Agent":
		desc := getString("description")
		if desc == "" {
			desc = getString("prompt")
		}
		if len(desc) > 80 {
			desc = desc[:80]
		}
		return desc
	default:
		data, _ := json.Marshal(input)
		s := string(data)
		if len(s) > 80 {
			s = s[:80]
		}
		return s
	}
}
