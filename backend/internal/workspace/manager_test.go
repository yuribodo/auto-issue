package workspace

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// initGitRepo creates a bare-minimum git repo for testing.
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

	// Create a file and commit so there's something to clone
	os.WriteFile(filepath.Join(dir, "README.md"), []byte("# Test"), 0644)
	exec.Command("git", "-C", dir, "add", ".").Run()
	exec.Command("git", "-C", dir, "commit", "-m", "init").Run()
}

func TestCreateAndPath(t *testing.T) {
	base := t.TempDir()
	repo := filepath.Join(t.TempDir(), "repo")
	os.MkdirAll(repo, 0755)
	initGitRepo(t, repo)

	mgr, err := NewManager(base)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	wsPath, err := mgr.Create("issue-1", repo)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	expected := filepath.Join(base, "issue-1")
	if wsPath != expected {
		t.Errorf("path = %q, want %q", wsPath, expected)
	}

	// Verify the cloned repo has the file
	if _, err := os.Stat(filepath.Join(wsPath, "README.md")); err != nil {
		t.Error("README.md not found in workspace")
	}
}

func TestCreateIdempotent(t *testing.T) {
	base := t.TempDir()
	repo := filepath.Join(t.TempDir(), "repo")
	os.MkdirAll(repo, 0755)
	initGitRepo(t, repo)

	mgr, _ := NewManager(base)

	path1, err := mgr.Create("issue-1", repo)
	if err != nil {
		t.Fatalf("first Create: %v", err)
	}

	path2, err := mgr.Create("issue-1", repo)
	if err != nil {
		t.Fatalf("second Create: %v", err)
	}

	if path1 != path2 {
		t.Errorf("paths differ: %q vs %q", path1, path2)
	}
}

func TestCreateInvalidRepo(t *testing.T) {
	base := t.TempDir()
	mgr, _ := NewManager(base)

	_, err := mgr.Create("issue-1", "/nonexistent/repo")
	if err == nil {
		t.Fatal("expected error for invalid repo path")
	}
}

func TestCleanup(t *testing.T) {
	base := t.TempDir()
	repo := filepath.Join(t.TempDir(), "repo")
	os.MkdirAll(repo, 0755)
	initGitRepo(t, repo)

	mgr, _ := NewManager(base)
	mgr.Create("issue-1", repo)

	if !mgr.Exists("issue-1") {
		t.Fatal("workspace should exist after create")
	}

	if err := mgr.Cleanup("issue-1"); err != nil {
		t.Fatalf("Cleanup: %v", err)
	}

	if mgr.Exists("issue-1") {
		t.Error("workspace should not exist after cleanup")
	}
}

func TestCleanupNonexistent(t *testing.T) {
	base := t.TempDir()
	mgr, _ := NewManager(base)

	// Should not error on missing workspace
	if err := mgr.Cleanup("nonexistent"); err != nil {
		t.Fatalf("Cleanup nonexistent: %v", err)
	}
}

func TestExists(t *testing.T) {
	base := t.TempDir()
	mgr, _ := NewManager(base)

	if mgr.Exists("issue-1") {
		t.Error("should not exist before create")
	}
}
