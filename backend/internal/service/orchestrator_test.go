package service

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
	"auto-issue/internal/constants"
	"auto-issue/internal/models"
	"auto-issue/internal/repository"
	"auto-issue/internal/workspace"
)

// noopBroadcaster implements EventBroadcaster for testing.
type noopBroadcaster struct{}

func (n *noopBroadcaster) Broadcast(issueID string, event agent.AgentEvent) {}

func setupTestEnv(t *testing.T) (*Orchestrator, repository.IssueRepository, string) {
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

	// Issue repository (in-memory)
	issueRepo := repository.NewMemoryIssueRepository()

	// Workspace manager
	wsBase := filepath.Join(t.TempDir(), "workspaces")
	ws, err := workspace.NewManager(wsBase)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	// Agent config with short timeout
	agentCfg := config.AgentConfig{
		Type:    "claude-code",
		Model:   "test-model",
		Timeout: config.Duration{Duration: 30 * time.Second},
	}

	orch := NewOrchestrator(ws, issueRepo, agentCfg, nil, &noopBroadcaster{}, "", 2)
	return orch, issueRepo, repoDir
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
	orch, repo, repoDir := setupTestEnv(t)
	defer orch.Shutdown()
	ctx := context.Background()

	repo.Create(ctx, "issue-1", "Add feature", "Implement the feature", repoDir)
	repo.Transition(ctx, "issue-1", constants.PhaseDeveloping)

	err := orch.processIssue("issue-1")
	if err != nil {
		t.Fatalf("processIssue: %v", err)
	}

	issue, _ := repo.Get(ctx, "issue-1")
	if issue.Phase != constants.PhaseHumanReview {
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
	orch, repo, repoDir := setupTestEnv(t)
	defer orch.Shutdown()
	ctx := context.Background()

	repo.Create(ctx, "issue-1", "Add feature", "Implement the feature", repoDir)
	repo.Transition(ctx, "issue-1", constants.PhaseDeveloping)
	orch.processIssue("issue-1")

	err := repo.SetFeedback(ctx, "issue-1", "Add unit tests please", 3)
	if err != nil {
		t.Fatalf("SetFeedback: %v", err)
	}

	issue, _ := repo.Get(ctx, "issue-1")
	if issue.Phase != constants.PhaseDeveloping {
		t.Fatalf("phase after feedback = %s, want developing", issue.Phase)
	}

	err = orch.processIssue("issue-1")
	if err != nil {
		t.Fatalf("processIssue iteration 2: %v", err)
	}

	issue, _ = repo.Get(ctx, "issue-1")
	if issue.Phase != constants.PhaseHumanReview {
		t.Errorf("phase = %s, want human_review", issue.Phase)
	}
	if issue.Iteration != 2 {
		t.Errorf("iteration = %d, want 2", issue.Iteration)
	}
}

func TestProcessIssueWrongPhase(t *testing.T) {
	orch, repo, repoDir := setupTestEnv(t)
	defer orch.Shutdown()

	repo.Create(context.Background(), "issue-1", "Feature", "Desc", repoDir)
	err := orch.processIssue("issue-1")
	if err == nil {
		t.Fatal("expected error for wrong phase")
	}
}

func TestEnqueueAndProcess(t *testing.T) {
	orch, repo, repoDir := setupTestEnv(t)
	orch.Start()
	defer orch.Shutdown()
	ctx := context.Background()

	repo.Create(ctx, "issue-1", "Feature", "Build it", repoDir)
	repo.Transition(ctx, "issue-1", constants.PhaseDeveloping)

	orch.Enqueue("issue-1")

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		issue, _ := repo.Get(ctx, "issue-1")
		if issue.Phase == constants.PhaseHumanReview {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("issue did not reach human_review within timeout")
}

func TestConcurrentIssues(t *testing.T) {
	orch, repo, repoDir := setupTestEnv(t)
	orch.Start()
	defer orch.Shutdown()
	ctx := context.Background()

	for i := 1; i <= 3; i++ {
		id := fmt.Sprintf("issue-%d", i)
		repo.Create(ctx, id, fmt.Sprintf("Feature %d", i), "Build it", repoDir)
		repo.Transition(ctx, id, constants.PhaseDeveloping)
		orch.Enqueue(id)
	}

	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		allDone := true
		for i := 1; i <= 3; i++ {
			issue, _ := repo.Get(ctx, fmt.Sprintf("issue-%d", i))
			if issue.Phase != constants.PhaseHumanReview {
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
	issue := &models.Issue{
		Title:       "Fix login",
		Description: "Login is broken",
	}
	got := buildIssuePrompt(issue)
	if got != "# Issue: Fix login\n\nLogin is broken" {
		t.Errorf("prompt without feedback =\n%q", got)
	}

	issue.LastFeedback = "Add error handling"
	got = buildIssuePrompt(issue)
	if !containsStr(got, "Previous human feedback") || !containsStr(got, "Add error handling") {
		t.Errorf("prompt with feedback should include feedback:\n%q", got)
	}
}

func TestBuildIssuePromptGithub(t *testing.T) {
	issue := &models.Issue{
		Title:       "Fix login",
		Description: "Login is broken",
		GithubRepo:  "owner/repo",
		IssueNumber: 42,
	}
	got := buildIssuePrompt(issue)
	if !containsStr(got, "owner/repo") {
		t.Error("github prompt should contain repo name")
	}
	if !containsStr(got, "#42") {
		t.Error("github prompt should contain issue number")
	}
	if !containsStr(got, "gh pr create") {
		t.Error("github prompt should contain PR creation instructions")
	}
}

func TestShutdownDrainsQueue(t *testing.T) {
	orch, _, _ := setupTestEnv(t)
	orch.Start()

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
