.PHONY: test lint build-cli build-server build-probe build-desktop docker-build docker-run

IMAGE ?= ghcr.io/spilloid/netviz

test:
	go test ./...

lint:
	go vet ./...

build-cli:
	go build -o bin/netviz-cli ./cmd/netviz-cli

build-server:
	go build -o bin/netviz-server ./cmd/netviz-server

build-probe:
	go build -o bin/netviz-probe ./cmd/netviz-probe

build-desktop:
	cd desktop && wails build

docker-build:
	docker build -f deploy/Dockerfile -t $(IMAGE):local .

docker-run:
	docker run --rm -p 8080:8080 $(IMAGE):local

