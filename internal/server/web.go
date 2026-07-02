package server

import (
	"embed"
	"io/fs"
	"net/http"
)

// The web UI source lives in /web and builds into webdist with fixed asset
// names (see web/vite.config.ts) so plain `go build` works without a node
// toolchain. Rebuild with `make build-web` after changing /web and commit the
// output.
//
//go:embed all:webdist
var webFS embed.FS

func (s *Server) webHandler() http.Handler {
	sub, err := fs.Sub(webFS, "webdist")
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusInternalServerError, "web UI assets unavailable")
		})
	}
	return http.FileServerFS(sub)
}
