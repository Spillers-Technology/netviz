package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"time"
)

// The self-contained update swap: instead of an external helper script, the
// staged new binary is launched as `netviz -apply-update -target <path>`.
// It waits for the old executable to become swappable (the old process is
// quitting), moves it aside as a .old backup, copies itself into place, and
// relaunches the installed binary. Pure Go — no cmd, tasklist, or shell.

const (
	applyUpdateFlag = "-apply-update"
	swapTimeout     = 30 * time.Second
	swapRetryDelay  = 250 * time.Millisecond
)

// maybeRunUpdateFinalizer handles the -apply-update invocation. It returns
// true when this process was a finalizer (the caller must exit instead of
// starting the UI).
func maybeRunUpdateFinalizer() bool {
	if len(os.Args) < 2 || os.Args[1] != applyUpdateFlag {
		return false
	}
	flags := flag.NewFlagSet("apply-update", flag.ContinueOnError)
	target := flags.String("target", "", "path of the installed executable to replace")
	relaunch := flags.Bool("relaunch", true, "start the installed executable after the swap")
	if err := flags.Parse(os.Args[2:]); err != nil || *target == "" {
		fmt.Fprintln(os.Stderr, "apply-update: -target is required")
		os.Exit(2)
	}

	self, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, "apply-update:", err)
		os.Exit(1)
	}
	if err := finalizeUpdate(self, *target, swapTimeout); err != nil {
		fmt.Fprintln(os.Stderr, "apply-update:", err)
		os.Exit(1)
	}
	if *relaunch {
		cmd := exec.Command(*target)
		cmd.Dir = fileDir(*target)
		hideConsoleWindow(cmd)
		_ = cmd.Start()
	}
	return true
}

// finalizeUpdate moves target aside as .old (retrying while the quitting
// process still holds it) and copies self into target's place. The .old
// backup is kept for rollback and cleaned up on the next normal start.
func finalizeUpdate(self string, target string, timeout time.Duration) error {
	backup := target + ".old"
	_ = os.Remove(backup)

	deadline := time.Now().Add(timeout)
	for {
		err := os.Rename(target, backup)
		if err == nil {
			break
		}
		if os.IsNotExist(err) {
			// Target already gone (e.g. a previous half-finished swap);
			// installing into the free slot is the right recovery.
			break
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("previous version would not release %s: %w", target, err)
		}
		time.Sleep(swapRetryDelay)
	}

	if err := copyFile(self, target, 0o755); err != nil {
		// Best-effort rollback so the install directory is never left empty.
		_ = os.Rename(backup, target)
		return fmt.Errorf("install new binary: %w", err)
	}
	return nil
}

// cleanupAfterUpdate removes leftovers from a completed swap (the .old
// backup and any stale staged binary). Called on normal startup.
func cleanupAfterUpdate() {
	executable, err := os.Executable()
	if err != nil {
		return
	}
	_ = os.Remove(executable + ".old")
	_ = os.Remove(executable + ".new")
}

func copyFile(src string, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return closeErr
	}
	return os.Rename(tmp, dst)
}

func fileDir(path string) string {
	if i := lastSeparator(path); i >= 0 {
		return path[:i]
	}
	return "."
}

func lastSeparator(path string) int {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' || path[i] == '\\' {
			return i
		}
	}
	return -1
}
