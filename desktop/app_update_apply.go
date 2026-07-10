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
	"strings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// maxUpdateBinarySize bounds extraction so a corrupt archive cannot fill the
// disk (decompression bomb guard).
const maxUpdateBinarySize = 512 << 20

// ApplyDownloadedUpdate extracts the desktop binary from a downloaded (and
// already checksum-verified) release archive, stages it next to the running
// executable, and hands off to the staged binary's own -apply-update mode to
// perform the swap and relaunch once this process exits (see
// update_finalize.go). Fully self-contained: no shell or helper scripts.
// macOS app bundles are staged for manual replacement.
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

	// The staged binary finalizes its own installation: it waits for this
	// process to release the executable, swaps it in with a .old backup, and
	// relaunches. No shell, no helper scripts — the updater is the update.
	cmd := exec.Command(staged, applyUpdateFlag, "-target", executable)
	cmd.Dir = filepath.Dir(executable)
	hideConsoleWindow(cmd)
	if err := cmd.Start(); err != nil {
		_ = os.Remove(staged)
		return "", fmt.Errorf("start update finalizer: %w", err)
	}

	message := "Update staged. NetViz will close and restart on the new version."
	if a.ctx != nil {
		wailsruntime.Quit(a.ctx)
	}
	return message, nil
}

// extractDesktopBinary finds the desktop executable inside a release archive
// and writes it to dest. Current archives put the desktop app at the package
// root for easier manual installs; older archives used netviz/desktop/<name>.
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
	if filepath.Base(name) != binaryName {
		return false
	}
	parts := strings.Split(strings.Trim(name, "/"), "/")
	for _, part := range parts[:len(parts)-1] {
		if part == "desktop" {
			return true
		}
	}
	return len(parts) == 1 || (len(parts) == 2 && parts[0] == "netviz")
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
	return nil, fmt.Errorf("archive does not contain desktop binary %s", binaryName)
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
	return nil, fmt.Errorf("archive does not contain desktop binary %s", binaryName)
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
