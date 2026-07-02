package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/Spillers-Technology/netviz/internal/version"
)

const (
	updateOwner = "Spillers-Technology"
	updateRepo  = "netviz"
)

type UpdateInfo struct {
	CurrentVersion string `json:"current_version"`
	LatestVersion  string `json:"latest_version"`
	Available      bool   `json:"available"`
	ReleaseURL     string `json:"release_url"`
	AssetName      string `json:"asset_name"`
	AssetURL       string `json:"asset_url"`
	ChecksumName   string `json:"checksum_name"`
	ChecksumURL    string `json:"checksum_url"`
	DownloadPath   string `json:"download_path"`
	Message        string `json:"message"`
}

type githubRelease struct {
	TagName string        `json:"tag_name"`
	HTMLURL string        `json:"html_url"`
	Assets  []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

func (a *App) CheckForUpdate() (UpdateInfo, error) {
	ctx, cancel := updateContext()
	defer cancel()
	return checkForUpdate(ctx, http.DefaultClient)
}

func (a *App) DownloadLatestUpdate() (UpdateInfo, error) {
	info, err := a.CheckForUpdate()
	if err != nil {
		return info, err
	}
	if !info.Available {
		return info, nil
	}
	ctx, cancel := updateContext()
	defer cancel()
	path, err := downloadUpdate(ctx, http.DefaultClient, info)
	if err != nil {
		return info, err
	}
	info.DownloadPath = path
	info.Message = "Update downloaded and verified."
	return info, nil
}

func (a *App) OpenUpdateDownload(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return errors.New("download path is empty")
	}
	return openPath(path)
}

func checkForUpdate(ctx context.Context, client *http.Client) (UpdateInfo, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", updateOwner, updateRepo)
	return checkForUpdateURL(ctx, client, url)
}

func checkForUpdateURL(ctx context.Context, client *http.Client, url string) (UpdateInfo, error) {
	info := UpdateInfo{CurrentVersion: version.Version}
	release, err := fetchLatestRelease(ctx, client, url)
	if err != nil {
		return info, err
	}

	info.LatestVersion = strings.TrimPrefix(release.TagName, "v")
	info.ReleaseURL = release.HTMLURL
	if compareVersions(info.LatestVersion, info.CurrentVersion) <= 0 {
		info.Message = "NetViz is up to date."
		return info, nil
	}

	assetName := expectedUpdateAssetName(release.TagName)
	asset, ok := findAsset(release.Assets, assetName)
	if !ok {
		info.Message = fmt.Sprintf("NetViz %s is available, but no %s asset was found.", release.TagName, assetName)
		return info, nil
	}
	info.Available = true
	info.AssetName = asset.Name
	info.AssetURL = asset.BrowserDownloadURL
	info.Message = fmt.Sprintf("NetViz %s is available.", release.TagName)

	if checksum, ok := findAsset(release.Assets, asset.Name+".sha256"); ok {
		info.ChecksumName = checksum.Name
		info.ChecksumURL = checksum.BrowserDownloadURL
	}
	return info, nil
}

func fetchLatestRelease(ctx context.Context, client *http.Client, url string) (githubRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return githubRelease{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "netviz-updater/"+version.Version)

	resp, err := client.Do(req)
	if err != nil {
		return githubRelease{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return githubRelease{}, fmt.Errorf("GitHub release check failed: %s %s", resp.Status, strings.TrimSpace(string(body)))
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return githubRelease{}, err
	}
	if release.TagName == "" {
		return githubRelease{}, errors.New("GitHub release response did not include a tag")
	}
	return release, nil
}

func downloadUpdate(ctx context.Context, client *http.Client, info UpdateInfo) (string, error) {
	if info.AssetURL == "" || info.AssetName == "" {
		return "", errors.New("update asset is not available")
	}
	dir, err := updateDownloadDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, info.AssetName)
	if err := downloadFile(ctx, client, info.AssetURL, path); err != nil {
		return "", err
	}
	if info.ChecksumURL != "" {
		expected, err := fetchExpectedSHA256(ctx, client, info.ChecksumURL)
		if err != nil {
			return "", err
		}
		if err := verifySHA256(path, expected); err != nil {
			return "", err
		}
	}
	return path, nil
}

func downloadFile(ctx context.Context, client *http.Client, url string, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "netviz-updater/"+version.Version)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download failed: %s", resp.Status)
	}

	tmp := path + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, resp.Body)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return closeErr
	}
	return os.Rename(tmp, path)
}

func fetchExpectedSHA256(ctx context.Context, client *http.Client, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "netviz-updater/"+version.Version)
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("checksum download failed: %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024))
	if err != nil {
		return "", err
	}
	fields := strings.Fields(string(body))
	if len(fields) == 0 || len(fields[0]) != sha256.Size*2 {
		return "", errors.New("checksum file did not contain a SHA-256 digest")
	}
	return strings.ToLower(fields[0]), nil
}

func verifySHA256(path string, expected string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	sum := sha256.New()
	if _, err := io.Copy(sum, file); err != nil {
		return err
	}
	actual := hex.EncodeToString(sum.Sum(nil))
	if actual != strings.ToLower(expected) {
		return fmt.Errorf("checksum mismatch: got %s, want %s", actual, expected)
	}
	return nil
}

func updateDownloadDir() (string, error) {
	dir, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "netviz", "updates"), nil
}

func openPath(path string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("explorer.exe", "/select,", path).Start()
	case "darwin":
		return exec.Command("open", "-R", path).Start()
	default:
		return exec.Command("xdg-open", filepath.Dir(path)).Start()
	}
}

func expectedUpdateAssetName(tag string) string {
	ext := ".tar.gz"
	if runtime.GOOS == "windows" {
		ext = ".zip"
	}
	return fmt.Sprintf("netviz-%s-%s-%s%s", tag, runtime.GOOS, runtime.GOARCH, ext)
}

func findAsset(assets []githubAsset, name string) (githubAsset, bool) {
	for _, asset := range assets {
		if asset.Name == name {
			return asset, true
		}
	}
	return githubAsset{}, false
}

func compareVersions(left, right string) int {
	lv := parseVersion(left)
	rv := parseVersion(right)
	for i := 0; i < 3; i++ {
		if lv[i] > rv[i] {
			return 1
		}
		if lv[i] < rv[i] {
			return -1
		}
	}
	return 0
}

func parseVersion(value string) [3]int {
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	value = strings.Split(value, "-")[0]
	parts := strings.Split(value, ".")
	var parsed [3]int
	for i := 0; i < len(parts) && i < len(parsed); i++ {
		n, _ := strconv.Atoi(parts[i])
		parsed[i] = n
	}
	return parsed
}

func updateContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 10*time.Minute)
}
