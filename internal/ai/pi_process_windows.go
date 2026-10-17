//go:build windows

package ai

import "os/exec"

func configurePiCommand(cmd *exec.Cmd) {}

func killPiCommand(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}
