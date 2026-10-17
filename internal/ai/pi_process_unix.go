//go:build !windows

package ai

import (
	"os/exec"
	"syscall"
)

func configurePiCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func killPiCommand(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	// Pi may launch helpers for extensions or providers. Kill the process group
	// first so cancellation cannot leave descendants holding stdout/stderr open.
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	return cmd.Process.Kill()
}
