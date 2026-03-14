package orchestrator

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"auto-issue/internal/agent"
	"auto-issue/internal/config"
	"auto-issue/internal/state"
	"auto-issue/internal/workspace"
)

// setupTestEnv creates a complete test environment with a fake agent script
// that just echoes instead of calling real Claude Code.
func setupTestEnv(t *testing.T) (*Orchestrator, *state.Store, string) {
	t.Helper()

	// Create a fake repo with git init
	repoDir := filepath.Join(t.TempDir(), "repo")
	os.MkdirAll(repoDir, 0755)
	initGitRepo(t, repoDir)

	// Create a fake "claude" script that echoes the prompt
	binDir := t.TempDir()
	fakeAgent := filepath.Join(binDir, "claude")
	os.WriteFile(fakeAgent, []byte("#!/bin/sh\necho \"Agent output for: $*\""), 0755)

	// Add fake agent to PATH
	os.Setenv("PATH", binDir+":"+os.Getenv("PATH"))

	// State store
	statePath := filepath.Join(t.TempDir(), "state.json")
	st, err := state.NewStore(statePath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}

	// Workspace manager
	wsBase := filepath.Join(t.TempDir(), "workspaces")
	ws, err := workspace.NewManager(wsBase)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	// Agent runner with short timeout
	runner := agent.NewRunner(config.AgentConfig{
		Type:    "claude-code",
		Model:   "test-model",
		Timeout: config.Duration{Duration: 30 * time.Second},
	})

	orch := New(ws, st, runner, 2)
	return orch, st, repoDir
}

func initGitRepo(t *testing.T, dir string) {
	t.Helper()
	cmds := [][]string{
		{"git", "init", dir},
		{"git", "-C", dir, "config", "user.email", "test@test.com"},
		{"git", "-C", dir, "config", "user.name", "Test"},
	}
	for _, args := range cmds {
		if out, err := exec.Command(args[0], args[1:]...).CombinedOutput(); err != nil {
			t.Fatalf("%v: %s: %v", args, out, err)
		}
	}
	os.WriteFile(filepath.Join(dir, "README.md"), []byte("# Test"), 0644)
	exec.Command("git", "-C", dir, "add", ".").Run()
	exec.Command("git", "-C", dir, "commit", "-m", "init").Run()
}

func TestProcessIssueFullCycle(t *testing.T) {
	orch, st, repoDir := setupTestEnv(t)
	defer orch.Shutdown()

	// Create issue and move to developing
	st.Create("issue-1", "Add feature", "Implement the feature", repoDir)
	st.Transition("issue-1", state.PhaseDeveloping)

	// Process the issue directly (not via queue)
	err := orch.processIssue("issue-1")
	if err != nil {
		t.Fatalf("processIssue: %v", err)
	}

	// Verify final state is human_review
	issue, _ := st.Get("issue-1")
	if issue.Phase != state.PhaseHumanReview {
		t.Errorf("phase = %s, want human_review", issue.Phase)
	}
	if issue.LastOutput == "" {
		t.Error("expected non-empty output")
	}
	if issue.Iteration != 1 {
		t.Errorf("iteration = %d, want 1", issue.Iteration)
	}
}

func TestProcessIssueWithFeedback(t *testing.T) {
	orch, st, repoDir := setupTestEnv(t)
	defer orch.Shutdown()

	// Create and run first cycle
	st.Create("issue-1", "Add feature", "Implement the feature", repoDir)
	st.Transition("issue-1", state.PhaseDeveloping)
	orch.processIssue("issue-1")

	// Submit feedback (reprove)
	err := st.SetFeedback("issue-1", "Add unit tests please", 3)
	if err != nil {
		t.Fatalf("SetFeedback: %v", err)
	}

	issue, _ := st.Get("issue-1")
	if issue.Phase != state.PhaseDeveloping {
		t.Fatalf("phase after feedback = %s, want developing", issue.Phase)
	}

	// Run second cycle
	err = orch.processIssue("issue-1")
	if err != nil {
		t.Fatalf("processIssue iteration 2: %v", err)
	}

	issue, _ = st.Get("issue-1")
	if issue.Phase != state.PhaseHumanReview {
		t.Errorf("phase = %s, want human_review", issue.Phase)
	}
	if issue.Iteration != 2 {
		t.Errorf("iteration = %d, want 2", issue.Iteration)
	}
}

func TestProcessIssueWrongPhase(t *testing.T) {
	orch, st, repoDir := setupTestEnv(t)
	defer orch.Shutdown()

	st.Create("issue-1", "Feature", "Desc", repoDir)
	// Issue is in backlog, not developing
	err := orch.processIssue("issue-1")
	if err == nil {
		t.Fatal("expected error for wrong phase")
	}
}

func TestEnqueueAndProcess(t *testing.T) {
	orch, st, repoDir := setupTestEnv(t)
	orch.Start()
	defer orch.Shutdown()

	st.Create("issue-1", "Feature", "Build it", repoDir)
	st.Transition("issue-1", state.PhaseDeveloping)

	orch.Enqueue("issue-1")

	// Poll for completion
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		issue, _ := st.Get("issue-1")
		if issue.Phase == state.PhaseHumanReview {
			return // success
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("issue did not reach human_review within timeout")
}

func TestConcurrentIssues(t *testing.T) {
	orch, st, repoDir := setupTestEnv(t)
	orch.Start()
	defer orch.Shutdown()

	// Enqueue 3 issues
	for i := 1; i <= 3; i++ {
		id := fmt.Sprintf("issue-%d", i)
		st.Create(id, fmt.Sprintf("Feature %d", i), "Build it", repoDir)
		st.Transition(id, state.PhaseDeveloping)
		orch.Enqueue(id)
	}

	// Wait for all to complete
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		allDone := true
		for i := 1; i <= 3; i++ {
			issue, _ := st.Get(fmt.Sprintf("issue-%d", i))
			if issue.Phase != state.PhaseHumanReview {
				allDone = false
				break
			}
		}
		if allDone {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("not all issues reached human_review within timeout")
}

func TestBuildIssuePrompt(t *testing.T) {
	orch := &Orchestrator{}

	issue := &state.IssueState{
		Title:       "Fix login",
		Description: "Login is broken",
	}
	got := orch.buildIssuePrompt(issue)
	if got != "# Issue: Fix login\n\nLogin is broken" {
		t.Errorf("prompt without feedback =\n%q", got)
	}

	issue.LastFeedback = "Add error handling"
	got = orch.buildIssuePrompt(issue)
	if !containsStr(got, "Previous human feedback") || !containsStr(got, "Add error handling") {
		t.Errorf("prompt with feedback should include feedback:\n%q", got)
	}
}

func TestShutdownDrainsQueue(t *testing.T) {
	orch, _, _ := setupTestEnv(t)
	orch.Start()

	// Shutdown without enqueuing — should not hang
	done := make(chan struct{})
	go func() {
		orch.Shutdown()
		close(done)
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	select {
	case <-done:
		// ok
	case <-ctx.Done():
		t.Fatal("Shutdown timed out")
	}
}

func containsStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
