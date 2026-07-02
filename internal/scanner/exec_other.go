//go:build !windows

package scanner

import "os/exec"

func hideConsoleWindow(_ *exec.Cmd) {}
