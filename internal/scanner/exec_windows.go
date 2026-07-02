//go:build windows

package scanner

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

// hideConsoleWindow keeps console child processes (arp) from flashing a
// window when the caller is a GUI-subsystem app like the desktop shell.
func hideConsoleWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}
