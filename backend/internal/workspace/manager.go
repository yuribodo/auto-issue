package workspace

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

type Manager struct {
	basePath string
}

func NewManager(basePath string) (*Manager, error) {
	abs, err := filepath.Abs(basePath)
	if err != nil {
		return nil, fmt.Errorf("resolving base path: %w", err)
	}

	if err := os.MkdirAll(abs, 0755); err != nil {
		return nil, fmt.Errorf("creating base directory: %w", err)
	}

	return &Manager{basePath: abs}, nil
}

// Create initializes a workspace for the given issue by cloning the local repo.
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

	// Clone the local repo into the workspace using git clone --local
	// This is efficient for local repos (uses hardlinks when possible)
	cmd := exec.Command("git", "clone", "--local", repoPath, wsPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git clone: %s: %w", string(output), err)
	}

	return wsPath, nil
}

// Path returns the deterministic workspace path for a given issue.
func (m *Manager) Path(issueID string) string {
	return filepath.Join(m.basePath, issueID)
}

// Cleanup removes the workspace directory for an issue.
func (m *Manager) Cleanup(issueID string) error {
	wsPath := m.Path(issueID)

	if _, err := os.Stat(wsPath); os.IsNotExist(err) {
		return nil // already gone
	}

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
