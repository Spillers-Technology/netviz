package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// maxUpdateBinarySize bounds extraction so a corrupt archive cannot fill the
// disk (decompression bomb guard).
const maxUpdateBinarySize = 512 << 20

// ApplyDownloadedUpdate extracts the desktop binary from a downloaded (and
// already checksum-verified) release archive and swaps it in for the running
// executable. On Windows the swap happens via a helper script after the app
// exits — the running exe cannot be replaced in place — so a successful call
// quits the app. On Linux the rename happens immediately and the user
// restarts when convenient. macOS app bundles are staged for manual
// replacement.
func (a *App) ApplyDownloadedUpdate(archivePath string) (string, error) {
	archivePath = strings.TrimSpace(archivePath)
	if archivePath == "" {
		return "", errors.New("no downloaded update to apply")
	}
	if _, err := os.Stat(archivePath); err != nil {
		return "", fmt.Errorf("downloaded update is missing: %w", err)
	}

	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return "", err
	}

	if runtime.GOOS == "darwin" {
		return "macOS updates are staged as an archive: quit NetViz and replace netviz.app with the copy inside the downloaded archive.", nil
	}

	staged := executable + ".new"
	if err := extractDesktopBinary(archivePath, filepath.Base(executable), staged); err != nil {
		return "", err
	}

	switch runtime.GOOS {
	case "windows":
		if err := launchWindowsSwapHelper(executable, staged); err != nil {
			_ = os.Remove(staged)
			return "", err
		}
		message := "Update staged. NetViz will close and restart on the new version."
		if a.ctx != nil {
			wailsruntime.Quit(a.ctx)
		}
		return message, nil
	default:
		backup := executable + ".old"
		_ = os.Remove(backup)
		if err := os.Rename(executable, backup); err != nil {
			_ = os.Remove(staged)
			return "", fmt.Errorf("back up current binary: %w", err)
		}
		if err := os.Rename(staged, executable); err != nil {
			_ = os.Rename(backup, executable)
			return "", fmt.Errorf("install new binary: %w", err)
		}
		if err := os.Chmod(executable, 0o755); err != nil {
			return "", err
		}
		return "Update installed. Restart NetViz to run the new version.", nil
	}
}

// extractDesktopBinary finds the desktop executable inside a release archive
// (zip or tar.gz, laid out as netviz/desktop/<name>) and writes it to dest.
func extractDesktopBinary(archivePath string, binaryName string, dest string) error {
	var reader io.ReadCloser
	var err error
	if strings.HasSuffix(archivePath, ".zip") {
		reader, err = openZipEntry(archivePath, binaryName)
	} else if strings.HasSuffix(archivePath, ".tar.gz") || strings.HasSuffix(archivePath, ".tgz") {
		reader, err = openTarEntry(archivePath, binaryName)
	} else {
		return fmt.Errorf("unsupported update archive format: %s", filepath.Base(archivePath))
	}
	if err != nil {
		return err
	}
	defer reader.Close()

	tmp := dest + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, io.LimitReader(reader, maxUpdateBinarySize))
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return closeErr
	}
	return os.Rename(tmp, dest)
}

func isDesktopEntry(name string, binaryName string) bool {
	name = strings.ReplaceAll(name, "\\", "/")
	return filepath.Base(name) == binaryName && strings.Contains(name, "/desktop/")
}

func openZipEntry(archivePath string, binaryName string) (io.ReadCloser, error) {
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, err
	}
	for _, file := range archive.File {
		if isDesktopEntry(file.Name, binaryName) {
			entry, err := file.Open()
			if err != nil {
				archive.Close()
				return nil, err
			}
			return &closerChain{Reader: entry, closers: []io.Closer{entry, archive}}, nil
		}
	}
	archive.Close()
	return nil, fmt.Errorf("archive does not contain desktop/%s", binaryName)
}

func openTarEntry(archivePath string, binaryName string) (io.ReadCloser, error) {
	file, err := os.Open(archivePath)
	if err != nil {
		return nil, err
	}
	unzipped, err := gzip.NewReader(file)
	if err != nil {
		file.Close()
		return nil, err
	}
	archive := tar.NewReader(unzipped)
	for {
		header, err := archive.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			unzipped.Close()
			file.Close()
			return nil, err
		}
		if header.Typeflag == tar.TypeReg && isDesktopEntry(header.Name, binaryName) {
			return &closerChain{Reader: archive, closers: []io.Closer{unzipped, file}}, nil
		}
	}
	unzipped.Close()
	file.Close()
	return nil, fmt.Errorf("archive does not contain desktop/%s", binaryName)
}

type closerChain struct {
	io.Reader
	closers []io.Closer
}

func (c *closerChain) Close() error {
	var first error
	for _, closer := range c.closers {
		if err := closer.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// launchWindowsSwapHelper writes and starts a detached cmd script that waits
// for this process to exit, swaps the staged binary in (keeping a .old
// backup), and relaunches NetViz.
func launchWindowsSwapHelper(executable string, staged string) error {
	script := fmt.Sprintf(`@echo off
:wait
tasklist /FI "PID eq %d" 2>nul | find "%d" >nul
if not errorlevel 1 (
  ping -n 2 127.0.0.1 >nul
  goto wait
)
move /y "%s" "%s.old" >nul
move /y "%s" "%s" >nul
start "" "%s"
del "%%~f0"
`, os.Getpid(), os.Getpid(), executable, executable, staged, executable, executable)

	dir, err := updateDownloadDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	scriptPath := filepath.Join(dir, "apply-update-"+strconv.Itoa(os.Getpid())+".cmd")
	if err := os.WriteFile(scriptPath, []byte(script), 0o700); err != nil {
		return err
	}

	cmd := exec.Command("cmd", "/c", scriptPath)
	cmd.Dir = filepath.Dir(executable)
	return cmd.Start()
}
