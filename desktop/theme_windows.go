//go:build windows

package main

import "golang.org/x/sys/windows/registry"

// systemPrefersDark reads the Windows app theme so the window background
// matches the UI before the web view paints, instead of flashing white.
func systemPrefersDark() bool {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer key.Close()
	light, _, err := key.GetIntegerValue("AppsUseLightTheme")
	return err == nil && light == 0
}
