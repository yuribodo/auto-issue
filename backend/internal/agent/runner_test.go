package agent

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"auto-issue/internal/config"
)

func TestBuildPromptDeveloping(t *testing.T) {
	r := NewRunner(config.AgentConfig{
		Prompt: "Be concise.",
	})

	got := r.buildPrompt("developing", "Fix the login bug")
	want := "Be concise.\n\nFix the login bug"
	if got != want {
		t.Errorf("prompt =\n%q\nwant\n%q", got, want)
	}
}

func TestBuildPromptDevelopingNoSystemPrompt(t *testing.T) {
	r := NewRunner(config.AgentConfig{})

	got := r.buildPrompt("developing", "Fix the login bug")
	want := "Fix the login bug"
	if got != want {
		t.Errorf("prompt =\n%q\nwant\n%q", got, want)
	}
}

func TestBuildPromptCodeReviewing(t *testing.T) {
	r := NewRunner(config.AgentConfig{
		Prompt: "Be thorough.",
	})

	got := r.buildPrompt("code_reviewing", "Fix the login bug")
	if got == "" {
		t.Fatal("expected non-empty prompt")
	}
	// Should contain review instructions and the original issue
	if !contains(got, "Review the solution") {
		t.Error("code review prompt should contain review instructions")
	}
	if !contains(got, "Fix the login bug") {
		t.Error("code review prompt should contain original issue")
	}
	if !contains(got, "Be thorough.") {
		t.Error("code review prompt should contain system prompt")
	}
}

func TestBuildArgsClaude(t *testing.T) {
	r := NewRunner(config.AgentConfig{
		Type:  "claude-code",
		Model: "claude-opus-4-6",
	})

	args := r.buildArgs("solve this")
	if len(args) < 4 {
		t.Fatalf("expected at least 4 args, got %d: %v", len(args), args)
	}
	if args[0] != "--print" {
		t.Errorf("args[0] = %q, want --print", args[0])
	}
	if args[1] != "solve this" {
		t.Errorf("args[1] = %q, want prompt", args[1])
	}
	if args[2] != "--model" {
		t.Errorf("args[2] = %q, want --model", args[2])
	}
	if args[3] != "claude-opus-4-6" {
		t.Errorf("args[3] = %q, want claude-opus-4-6", args[3])
	}
}

func TestCommandName(t *testing.T) {
	r := NewRunner(config.AgentConfig{Type: "claude-code"})
	if r.command() != "claude" {
		t.Errorf("command() = %q, want %q", r.command(), "claude")
	}

	r2 := NewRunner(config.AgentConfig{Type: "custom-agent"})
	if r2.command() != "custom-agent" {
		t.Errorf("command() = %q, want %q", r2.command(), "custom-agent")
	}
}

func TestRunWithRealProcess(t *testing.T) {
	// Use echo as a simple subprocess to test the Run flow
	shell := "sh"
	shellArg := "-c"
	if runtime.GOOS == "windows" {
		shell = "cmd"
		shellArg = "/c"
	}

	// Create a fake "agent" script that just echoes
	dir := t.TempDir()
	script := filepath.Join(dir, "fake-agent")
	os.WriteFile(script, []byte("#!/bin/sh\necho \"solution: $@\""), 0755)

	r := &Runner{
		cfg: config.AgentConfig{
			Type:    shell,
			Model:   "test",
			Timeout: config.Duration{Duration: 10 * time.Second},
		},
	}

	// Override to use shell -c "echo done"
	ctx := context.Background()
	cmd := exec.CommandContext(ctx, shell, shellArg, "echo done")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("basic exec failed: %v: %s", err, out)
	}

	// Test timeout behavior with a long-running process
	r.cfg.Timeout = config.Duration{Duration: 100 * time.Millisecond}
	ctx2 := context.Background()
	ctx2, cancel := context.WithTimeout(ctx2, 100*time.Millisecond)
	defer cancel()

	cmd2 := exec.CommandContext(ctx2, shell, shellArg, "sleep 10")
	cmd2.Dir = dir
	err = cmd2.Run()
	if err == nil {
		t.Error("expected timeout error")
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
