package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	if maybeRunUpdateFinalizer() {
		return
	}
	cleanupAfterUpdate()

	app := NewApp()

	// Match the theme's page color so startup never flashes the wrong one.
	background := &options.RGBA{R: 244, G: 247, B: 251, A: 255}
	if systemPrefersDark() {
		background = &options.RGBA{R: 7, G: 20, B: 38, A: 255}
	}

	err := wails.Run(&options.App{
		Title:            "NetViz",
		Width:            1280,
		Height:           800,
		MinWidth:         960,
		MinHeight:        640,
		BackgroundColour: background,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Windows: &windows.Options{
			Theme: windows.SystemDefault,
		},
		OnStartup: app.startup,
		Menu:      appMenu(app),
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		println("error:", err.Error())
	}
}

func appMenu(app *App) *menu.Menu {
	root := menu.NewMenu()
	file := root.AddSubmenu("File")
	file.AddText("Open Scan", keys.CmdOrCtrl("o"), func(_ *menu.CallbackData) {
		_, _ = app.OpenScanFile()
	})
	file.AddText("Save Scan", keys.CmdOrCtrl("s"), func(_ *menu.CallbackData) {
		_ = app.SaveScanFile()
	})
	file.AddText("Save CSV", keys.Combo("s", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		_ = app.SaveCSVFile()
	})
	return root
}
