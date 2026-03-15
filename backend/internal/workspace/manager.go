package workspace

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Manager struct {
	basePath  string
	clonePath string // base directory for bare clones
}

func NewManager(basePath string) (*Manager, error) {
	abs, err := filepath.Abs(basePath)
	if err != nil {
		return nil, fmt.Errorf("resolving base path: %w", err)
	}

	if err := os.MkdirAll(abs, 0755); err != nil {
		return nil, fmt.Errorf("creating base directory: %w", err)
	}

	cloneDir := filepath.Join(filepath.Dir(abs), "clones")
	if err := os.MkdirAll(cloneDir, 0755); err != nil {
		return nil, fmt.Errorf("creating clones directory: %w", err)
	}

	return &Manager{basePath: abs, clonePath: cloneDir}, nil
}

// Create initializes a workspace for the given issue using git worktree.
// For local repos, it creates a worktree from the repo.
// If the workspace already exists, it returns the existing path (idempotent).
func (m *Manager) Create(issueID string, repoPath string) (string, error) {
	wsPath := m.Path(issueID)

	// Idempotent: if workspace already exists, reuse it
	if info, err := os.Stat(wsPath); err == nil && info.IsDir() {
		return wsPath, nil
	}

	// Validate repo path exists
	info, err := os.Stat(repoPath)
	if err != nil {
		return "", fmt.Errorf("repo path %q: %w", repoPath, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("repo path %q is not a directory", repoPath)
	}

	// Create worktree from the local repo
	branch := fmt.Sprintf("auto-issue/%s", issueID)
	cmd := exec.Command("git", "worktree", "add", "-b", branch, wsPath, "HEAD")
	cmd.Dir = repoPath
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git worktree add: %s: %w", string(output), err)
	}

	return wsPath, nil
}

// CreateFromRemote initializes a workspace for a GitHub repo.
// It maintains a base clone in ~/.auto-issue/clones/ and creates worktrees from it.
func (m *Manager) CreateFromRemote(issueID string, repo string, ghToken string) (string, error) {
	wsPath := m.Path(issueID)

	// Idempotent
	if info, err := os.Stat(wsPath); err == nil && info.IsDir() {
		return wsPath, nil
	}

	// Ensure we have a base clone
	cloneDir, err := m.ensureClone(repo, ghToken)
	if err != nil {
		return "", fmt.Errorf("ensuring clone: %w", err)
	}

	// Fetch latest
	fetchCmd := exec.Command("git", "fetch", "origin")
	fetchCmd.Dir = cloneDir
	fetchCmd.Env = append(os.Environ(), fmt.Sprintf("GH_TOKEN=%s", ghToken), fmt.Sprintf("GITHUB_TOKEN=%s", ghToken))
	if output, err := fetchCmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("git fetch: %s: %w", string(output), err)
	}

	// Create worktree
	branch := fmt.Sprintf("auto-issue/%s", issueID)
	cmd := exec.Command("git", "worktree", "add", "-b", branch, wsPath, "origin/HEAD")
	cmd.Dir = cloneDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git worktree add: %s: %w", string(output), err)
	}

	return wsPath, nil
}

// ensureClone ensures a base clone exists for the given repo.
func (m *Manager) ensureClone(repo string, ghToken string) (string, error) {
	// Sanitize repo name for directory
	safeName := strings.ReplaceAll(repo, "/", "--")
	cloneDir := filepath.Join(m.clonePath, safeName)

	if info, err := os.Stat(cloneDir); err == nil && info.IsDir() {
		return cloneDir, nil
	}

	var repoURL string
	if ghToken != "" {
		repoURL = fmt.Sprintf("https://x-access-token:%s@github.com/%s.git", ghToken, repo)
	} else {
		repoURL = fmt.Sprintf("https://github.com/%s.git", repo)
	}

	cmd := exec.Command("git", "clone", repoURL, cloneDir)
	cmd.Env = append(os.Environ(), fmt.Sprintf("GH_TOKEN=%s", ghToken), fmt.Sprintf("GITHUB_TOKEN=%s", ghToken))
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git clone: %s: %w", string(output), err)
	}

	return cloneDir, nil
}

// Path returns the deterministic workspace path for a given issue.
func (m *Manager) Path(issueID string) string {
	return filepath.Join(m.basePath, issueID)
}

// Cleanup removes the workspace worktree and branch for an issue.
func (m *Manager) Cleanup(issueID string) error {
	wsPath := m.Path(issueID)

	if _, err := os.Stat(wsPath); os.IsNotExist(err) {
		return nil // already gone
	}

	// Try to remove as worktree first
	// Find the parent repo by checking .git file in worktree
	gitFile := filepath.Join(wsPath, ".git")
	if data, err := os.ReadFile(gitFile); err == nil {
		// .git file in worktree contains "gitdir: /path/to/repo/.git/worktrees/..."
		line := strings.TrimSpace(string(data))
		if strings.HasPrefix(line, "gitdir: ") {
			gitDir := strings.TrimPrefix(line, "gitdir: ")
			// Navigate up from .git/worktrees/<name> to the repo root
			repoGitDir := filepath.Dir(filepath.Dir(gitDir))
			repoDir := filepath.Dir(repoGitDir)

			// If repoGitDir ends with .git, the repo root is its parent
			if filepath.Base(repoGitDir) == "worktrees" {
				repoGitDir = filepath.Dir(repoGitDir)
				repoDir = filepath.Dir(repoGitDir)
			}

			removeCmd := exec.Command("git", "worktree", "remove", "--force", wsPath)
			removeCmd.Dir = repoDir
			removeCmd.CombinedOutput() // best effort

			branch := fmt.Sprintf("auto-issue/%s", issueID)
			branchCmd := exec.Command("git", "branch", "-D", branch)
			branchCmd.Dir = repoDir
			branchCmd.CombinedOutput() // best effort

			return nil
		}
	}

	// Fallback: just remove the directory
	if err := os.RemoveAll(wsPath); err != nil {
		return fmt.Errorf("removing workspace %q: %w", wsPath, err)
	}
	return nil
}

// Exists checks if a workspace directory exists for the given issue.
func (m *Manager) Exists(issueID string) bool {
	info, err := os.Stat(m.Path(issueID))
	return err == nil && info.IsDir()
}
