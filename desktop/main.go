package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	if maybeRunUpdateFinalizer() {
		return
	}
	cleanupAfterUpdate()

	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "NetViz",
		Width:  1120,
		Height: 720,
		AssetServer: &assetserver.Options{
			Assets: assets,
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
