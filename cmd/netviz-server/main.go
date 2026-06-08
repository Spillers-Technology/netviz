package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"

	"github.com/Spillers-Technology/netviz/internal/server"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	flag.Parse()

	srv := server.New()
	err := srv.ListenAndServe(*addr)
	if err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}
