FROM golang:1.25-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/netviz-server ./cmd/netviz-server

FROM alpine:3.20

RUN adduser -D -H -u 10001 netviz && mkdir -p /data && chown netviz /data
USER netviz
COPY --from=build /out/netviz-server /usr/local/bin/netviz-server
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["netviz-server"]
CMD ["-addr", ":8080", "-db", "/data/netviz.db"]
