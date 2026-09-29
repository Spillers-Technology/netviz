//go:build !windows

package main

// systemPrefersDark has no portable answer outside Windows; the web view
// still follows prefers-color-scheme once it paints.
func systemPrefersDark() bool {
	return false
}
