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
)

var prRegex = regexp.MustCompile(`https://github\.com/.+/pull/\d+`)

func buildPrompt(systemPrompt, mode, issuePrompt string) string {
	var systemCtx string
	if systemPrompt != "" {
		systemCtx = systemPrompt + "\n\n"
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

func spawnDirect(ctx context.Context, command string, args []string, workspacePath string, env []string) (*exec.Cmd, error) {
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = workspacePath
	cmd.Env = env
	return cmd, nil
}

// textBufferer accumulates text deltas and flushes on sentence boundaries or timeout.
type textBufferer struct {
	buf        strings.Builder
	mu         sync.Mutex
	flushTimer *time.Timer
	eventCh    chan<- AgentEvent
	ctx        context.Context
}

func newTextBufferer(ctx context.Context, eventCh chan<- AgentEvent) *textBufferer {
	tb := &textBufferer{
		flushTimer: time.NewTimer(400 * time.Millisecond),
		eventCh:    eventCh,
		ctx:        ctx,
	}
	tb.flushTimer.Stop()

	go func() {
		for {
			select {
			case <-tb.flushTimer.C:
				tb.Flush()
			case <-ctx.Done():
				return
			}
		}
	}()

	return tb
}

func (tb *textBufferer) Append(text string) {
	tb.mu.Lock()
	tb.buf.WriteString(text)
	hasBoundary := strings.ContainsAny(text, ".!?\n")
	tb.mu.Unlock()

	if hasBoundary {
		tb.flushTimer.Stop()
		tb.Flush()
	} else {
		tb.flushTimer.Reset(400 * time.Millisecond)
	}
}

func (tb *textBufferer) Flush() {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	if tb.buf.Len() == 0 {
		return
	}
	text := tb.buf.String()
	tb.buf.Reset()
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			select {
			case tb.eventCh <- AgentEvent{Type: EventText, Timestamp: time.Now(), Prefix: "AGENT", Content: trimmed}:
			case <-tb.ctx.Done():
				return
			}
		}
	}
}

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

func plainTextParser(ctx context.Context, scanner *bufio.Scanner, eventCh chan<- AgentEvent, result *RunResult) {
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}

		trimmed := strings.TrimSpace(line)
		select {
		case eventCh <- AgentEvent{Type: EventText, Timestamp: time.Now(), Prefix: "AGENT", Content: trimmed}:
		case <-ctx.Done():
			return
		}

		if match := prRegex.FindString(line); match != "" {
			result.PRURL = match
			select {
			case eventCh <- AgentEvent{Type: EventPR, Timestamp: time.Now(), Prefix: "PR", Content: match}:
			case <-ctx.Done():
			}
		}
	}
}

func baseEnv(ghToken string) []string {
	env := os.Environ()
	if ghToken != "" {
		env = append(env,
			fmt.Sprintf("GH_TOKEN=%s", ghToken),
			fmt.Sprintf("GITHUB_TOKEN=%s", ghToken),
		)
	}
	return env
}
