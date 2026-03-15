//go:build !windows

package agent

import (
	"context"
	"fmt"
	"os"
	"os/exec"

	"github.com/creack/pty"
)

// spawnWithPTY starts a command with a pseudo-terminal to avoid buffering.
func spawnWithPTY(ctx context.Context, command string, args []string, workspacePath string, env []string) (*os.File, *exec.Cmd, error) {
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = workspacePath
	cmd.Env = env

	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, nil, fmt.Errorf("starting agent with pty: %w", err)
	}

	return ptmx, cmd, nil
}
