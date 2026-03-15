//go:build windows

package agent

import (
	"context"
	"fmt"
	"os"
	"os/exec"
)

// spawnWithPTY is not available on Windows — returns an error so callers fall back to spawnDirect.
func spawnWithPTY(ctx context.Context, command string, args []string, workspacePath string, env []string) (*os.File, *exec.Cmd, error) {
	return nil, nil, fmt.Errorf("pty not supported on windows")
}
